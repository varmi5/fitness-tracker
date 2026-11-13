import { loadEnvFile } from "node:process";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { getAuth, getDatabase } from "../lib/runtime";
import { account, session, user } from "../lib/schema";

async function resetPassword() {
  try { loadEnvFile(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !process.stdin.isTTY) throw new Error("Run this command in an interactive terminal with an email address.");
  const silent = new Writable({ write(_buffer, _encoding, done) { done(); } });
  const terminal = createInterface({ input: process.stdin, output: silent, terminal: true });
  process.stderr.write("New password (hidden): ");
  const password = await new Promise<string>((resolve) => terminal.question("", resolve));
  terminal.close();
  process.stderr.write("\n");
  const { password: settings } = await getAuth().$context;
  if (password.length < settings.config.minPasswordLength || password.length > settings.config.maxPasswordLength) {
    throw new Error("The password length does not meet the configured limits.");
  }
  const hash = await settings.hash(password);
  await getDatabase().transaction(async (tx) => {
    const [target] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (!target) throw new Error("Account not found.");
    const result = await tx.update(account).set({ password: hash, updatedAt: new Date() })
      .where(and(eq(account.userId, target.id), eq(account.providerId, "credential"))).returning({ id: account.id });
    if (!result.length) throw new Error("No password account was found.");
    await tx.delete(session).where(eq(session.userId, target.id));
  });
  console.log("Password updated and existing sessions revoked.");
}

resetPassword().then(() => process.exit(0), () => { console.error("Password reset failed."); process.exit(1); });
