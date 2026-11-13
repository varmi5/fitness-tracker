export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { signupMode } = await import("./lib/signup-config");
    signupMode();
  }
}
