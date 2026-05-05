import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      githubId?: string;
      githubUsername?: string;
      avatarUrl?: string;
      accessToken?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    githubId?: string;
    githubUsername?: string;
    avatarUrl?: string;
    accessToken?: string;
  }
}
