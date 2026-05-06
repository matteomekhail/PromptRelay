const domain =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXTAUTH_URL ??
  "http://localhost:3000";

const authConfig = {
  providers: [
    {
      domain: domain.replace(/\/$/, ""),
      applicationID: "convex",
    },
  ],
};

export default authConfig;
