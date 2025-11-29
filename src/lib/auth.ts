import NextAuth, { NextAuthConfig } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "./prisma"

// Auth config with Google OAuth and Credentials
export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        // Import dynamically to avoid edge runtime issues
        const { compare } = await import("bcryptjs")
        const { prisma } = await import("./prisma")

        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email as string
          }
        })

        if (!user) {
          return null
        }

        // Check if user has a password (OAuth users won't have one)
        if (!user.passwordHash) {
          return null
        }

        const isPasswordValid = await compare(
          credentials.password as string,
          user.passwordHash
        )

        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        }
      }
    })
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      // Handle OAuth account linking
      if (account?.provider === "google") {
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email! },
          include: { accounts: true }
        })

        if (existingUser) {
          // Check if this Google account is already linked
          const existingAccount = existingUser.accounts.find(
            (acc: typeof existingUser.accounts[0]) => acc.provider === "google" && acc.providerAccountId === account.providerAccountId
          )

          if (!existingAccount) {
            // Link the Google account to the existing user
            await prisma.account.create({
              data: {
                userId: existingUser.id,
                type: account.type,
                provider: account.provider,
                providerAccountId: account.providerAccountId,
                refresh_token: account.refresh_token as string | null | undefined,
                access_token: account.access_token as string | null | undefined,
                expires_at: account.expires_at as number | null | undefined,
                token_type: account.token_type as string | null | undefined,
                scope: account.scope as string | null | undefined,
                id_token: account.id_token as string | null | undefined,
                session_state: account.session_state as string | null | undefined,
              }
            })
          }

          // Update user info from Google
          await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              name: user.name || existingUser.name,
              image: user.image || existingUser.image,
              emailVerified: ('emailVerified' in user ? user.emailVerified : null) || existingUser.emailVerified,
            }
          })

          // Set the user ID so JWT can use it
          user.id = existingUser.id
        }
      }
      return true
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
      }
      return session
    }
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
