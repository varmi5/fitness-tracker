import { getInstanceConfig } from "../../lib/instance-config";

export const dynamic = "force-dynamic";

export default function Page() {
  const { operatorName, supportEmail, hostingLocation } = getInstanceConfig();
  return <main className="shell" style={{ maxWidth: 760, padding: "2rem 1.25rem", lineHeight: 1.7 }}><h1>FitnessTrackr terms</h1><p>FitnessTrackr is a free personal project by {operatorName}, hosted on {hostingLocation} and offered to users in countries supported by the plugin platform. There are no paid subscriptions or purchases in this app.</p><p>The service provides personal food, nutrition, energy and measurement tracking. Food estimates, portion sizes, wearable calorie estimates and calculated deficits can be inaccurate. The service does not provide medical diagnosis or treatment.</p><p>Keep your account secure and only connect accounts and data you are authorised to use. Do not attempt to access another user's records, abuse signup or search services, or disrupt the service. Optional third-party services have their own terms and availability.</p><p>This personal service has no uptime or support guarantee. You may stop using it, revoke connections, export your records and delete your account in Settings.{supportEmail ? <> Contact <a href={`mailto:${supportEmail}`}>{supportEmail}</a> for questions.</> : <> Contact {operatorName} for questions.</>}</p><p><a href="/">Open FitnessTrackr</a> · <a href="/connect">Connect</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a></p></main>;
}
