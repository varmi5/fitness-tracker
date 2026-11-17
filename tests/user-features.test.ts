import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { macroEnergy, rebalanceMacros } from "../lib/macro-targets";
import { nutritionData } from "../lib/nutrition-data";
import { dueTimes, processReminders, registerPush, saveReminderSettings, reminderSettings, unregisterPush } from "../lib/reminders";
import { processGoogleMeals } from "../lib/google-meal-worker";
import { seal } from "../lib/google-health";
import * as schema from "../lib/schema";
const pg = new PGlite(); const db = drizzle(pg, { schema });
before(async () => {
  for (const file of (await readdir("migrations")).filter((name) => name.endsWith(".sql")).sort()) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  for (const id of ["USER-A", "USER-B"]) await db.insert(schema.user).values({ id, name: id, email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() });
});
after(() => pg.close());
test("macro rebalance keeps protein/fibre, historical plans and accounts isolated", async () => {
 const plan = rebalanceMacros({ calories: 1900, proteinG: 150, carbsG: 200, fatG: 70, fibreG: 32 });
 assert.equal(plan.proteinG,150); assert.equal(plan.fibreG,32); assert.ok(Math.abs(macroEnergy(plan)-1900)<1);
 assert.throws(()=>rebalanceMacros({...plan,proteinG:1000}));
 const a = nutritionData(db,"USER-A"); await a.setNutritionTargets({...plan,effectiveFrom:"2026-11-17"});
 assert.equal((await a.daily("2026-11-17")).macroTargets.proteinG,150);
 assert.notEqual((await a.daily("2026-11-16")).macroTargets.proteinG,150);
 assert.notEqual((await nutritionData(db,"USER-B").daily("2026-11-17")).macroTargets.proteinG,150);
});
test("push schedules respect London DST, encrypted device ownership and deduplicate delivery", async () => {
 process.env.BETTER_AUTH_SECRET=randomBytes(32).toString("hex"); process.env.VAPID_PUBLIC_KEY="synthetic"; process.env.VAPID_PRIVATE_KEY="synthetic";
 const subscription={endpoint:"https://fcm.googleapis.com/fcm/send/synthetic-device",keys:{p256dh:"a".repeat(87),auth:"a".repeat(22)}};
 await registerPush(db,"USER-A",subscription); await saveReminderSettings(db,"USER-A",{enabled:true,times:["18:30"]});
 assert.equal((await db.select().from(schema.pushSubscription))[0].credential.includes(subscription.endpoint),false);
 assert.deepEqual(dueTimes(["18:30"],new Date("2026-07-01T17:31:00Z"),"Europe/London"),["18:30"]);
 let calls=0; const send = (async (_subscription: unknown,payload?:string|Buffer|null)=>{ calls++; assert.ok(!String(payload).includes("150")); return {statusCode:201,body:"",headers:{}}; }) as Parameters<typeof processReminders>[2];
 const now=new Date("2026-11-17T18:31:00Z"); await processReminders(db,now,send); await processReminders(db,now,send); assert.equal(calls,1);
 await registerPush(db,"USER-B",subscription); await unregisterPush(db,"USER-A",subscription.endpoint);
 assert.equal((await reminderSettings(db,"USER-B")).deviceCount,1); assert.equal((await reminderSettings(db,"USER-A")).deviceCount,0);
 await assert.rejects(()=>registerPush(db,"USER-B",{...subscription,endpoint:"https://127.0.0.1/private"}));
 delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
});
test("Google meal retries reuse IDs, replacement confirms before cleanup and deletion queues survive local deletion", async () => {
 process.env.FITNESS_INTEGRATION_KEY=randomBytes(32).toString("hex");
 const a=nutritionData(db,"USER-A"); const b=nutritionData(db,"USER-B");
 await db.insert(schema.healthIntegration).values({userId:"USER-A",provider:"google",credential:seal({accessToken:"synthetic",refreshToken:"synthetic",expiresAt:Date.now()+3600000,scopes:["https://www.googleapis.com/auth/googlehealth.nutrition.writeonly"]},"USER-A")});
 await a.setPreferences({timezone:"Europe/London",preferredEnergySource:"google",googleTwoWaySync:true});
 const logged=await a.log({day:"2026-11-17",time:"08:00",name:"Eggs",category:"breakfast",items:[{name:"Egg",amount:1,unit:"item",calories:80}]});
 await b.log({day:"2026-11-17",time:"08:00",name:"Private",category:"breakfast",items:[{name:"Egg",amount:1,unit:"item",calories:80}]});
 assert.equal((await db.select().from(schema.googleMealSync)).length,1);
 const original=globalThis.fetch; const remote=new Map<string,unknown>(); let posts=0; let loseResponse=true;
 globalThis.fetch=(async(input: string|URL|Request,init?:RequestInit)=>{
  const url=String(input), name=url.replace("https://health.googleapis.com/v4/","");
  if(init?.method==="POST"&&url.endsWith(":batchDelete")){ for(const key of JSON.parse(String(init.body)).names) remote.delete(key); return Response.json({done:true,response:{}}); }
  if(init?.method==="POST"){posts++;const body=JSON.parse(String(init.body));assert.ok(body.name);assert.equal(url.includes("dataPointId"),false);remote.set(body.name,body);if(loseResponse){loseResponse=false;throw new Error("synthetic lost response");}return Response.json({done:true,response:{name:body.name}});}
  return remote.has(name)?Response.json({name}):Response.json({}, {status:404});
 }) as typeof fetch;
 try {
  await processGoogleMeals(db,"USER-A",1); assert.equal(remote.size,1);
  await db.update(schema.googleMealSync).set({nextAttemptAt:new Date(0)}); await processGoogleMeals(db,"USER-A",1); assert.equal(posts,1);
  await a.update({id:logged.meal.id,appendItems:[{name:"Tea",amount:1,unit:"cup",calories:5}],idempotencyKey:"tea"});
  await processGoogleMeals(db,"USER-A",1);assert.equal(remote.size,1);assert.equal(posts,2);
  await a.remove(logged.meal.id,true);assert.equal((await db.select().from(schema.googleMealSync))[0].action,"delete");
  await processGoogleMeals(db,"USER-A",1);assert.equal(remote.size,0);assert.equal((await db.select().from(schema.googleMealSync)).length,0);
 } finally {globalThis.fetch=original;delete process.env.FITNESS_INTEGRATION_KEY;}
});
