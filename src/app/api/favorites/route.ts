import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

// GET - Retrieve user's favorites
export async function GET(req: Request) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const favorites = await prisma.favorite.findMany({
      where: {
        userId: session.user.id
      },
      orderBy: {
        addedAt: 'desc'
      }
    })

    // Parse metadata JSON strings
    const favoritesWithMetadata = favorites.map((f: typeof favorites[0]) => ({
      ...f,
      metadata: f.metadata ? JSON.parse(f.metadata) : null
    }))

    return NextResponse.json({ favorites: favoritesWithMetadata })
  } catch (error) {
    console.error("Error fetching favorites:", error)
    return NextResponse.json(
      { error: "Failed to fetch favorites" },
      { status: 500 }
    )
  }
}

// POST - Add a slide to favorites
export async function POST(req: Request) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { caseId, notes, metadata } = await req.json()

    if (!caseId) {
      return NextResponse.json(
        { error: "caseId is required" },
        { status: 400 }
      )
    }

    // Check if already favorited
    const existing = await prisma.favorite.findUnique({
      where: {
        userId_caseId: {
          userId: session.user.id,
          caseId
        }
      }
    })

    if (existing) {
      return NextResponse.json(
        { error: "Already in favorites" },
        { status: 400 }
      )
    }

    // Create favorite entry
    const favorite = await prisma.favorite.create({
      data: {
        userId: session.user.id,
        caseId,
        notes: notes || null,
        metadata: metadata ? JSON.stringify(metadata) : null
      }
    })

    return NextResponse.json({
      success: true,
      favorite: {
        ...favorite,
        metadata: favorite.metadata ? JSON.parse(favorite.metadata) : null
      }
    })
  } catch (error) {
    console.error("Error saving favorite:", error)
    return NextResponse.json(
      { error: "Failed to save favorite" },
      { status: 500 }
    )
  }
}

// DELETE - Remove a slide from favorites
export async function DELETE(req: Request) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    const caseId = searchParams.get('caseId')

    if (!caseId) {
      return NextResponse.json(
        { error: "caseId is required" },
        { status: 400 }
      )
    }

    await prisma.favorite.delete({
      where: {
        userId_caseId: {
          userId: session.user.id,
          caseId
        }
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error removing favorite:", error)
    return NextResponse.json(
      { error: "Failed to remove favorite" },
      { status: 500 }
    )
  }
}
