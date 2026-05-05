import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: { params: { scope: "read:user user:email public_repo" } },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.githubId = String(profile.id);
        token.githubUsername = (profile as { login?: string }).login ?? "";
        token.avatarUrl = (profile as { avatar_url?: string }).avatar_url ?? "";
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const user = session.user as any;
        user.githubId = token.githubId;
        user.githubUsername = token.githubUsername;
        user.avatarUrl = token.avatarUrl;
        user.accessToken = token.accessToken;
      }
      return session;
    },
  },
});
