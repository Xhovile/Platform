function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Email configuration is missing: ${name}`);
  }
  return value;
}

export function getEmailConfig() {
  return {
    brevoApiKey: getRequiredEnv("BREVO_API_KEY"),
    apiBaseUrl: "https://api.brevo.com/v3",
  } as const;
}
