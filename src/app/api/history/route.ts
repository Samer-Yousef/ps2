import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

// GET - Retrieve user's slide history
export async function GET(req: Request) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const history = await prisma.slideHistory.findMany({
      where: {
        userId: session.user.id
      },
      orderBy: {
        viewedAt: 'desc'
      },
      take: 100 // Limit to last 100 views
    })

    // Parse metadata JSON strings
    const historyWithMetadata = history.map(h => ({
      ...h,
      metadata: h.metadata ? JSON.parse(h.metadata) : null
    }))

    return NextResponse.json({ history: historyWithMetadata })
  } catch (error) {
    console.error("Error fetching history:", error)
    return NextResponse.json(
      { error: "Failed to fetch history" },
      { status: 500 }
    )
  }
}

// POST - Add a slide to history
export async function POST(req: Request) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { caseId, metadata } = await req.json()

    if (!caseId) {
      return NextResponse.json(
        { error: "caseId is required" },
        { status: 400 }
      )
    }

    // Create history entry
    const historyEntry = await prisma.slideHistory.create({
      data: {
        userId: session.user.id,
        caseId,
        metadata: metadata ? JSON.stringify(metadata) : null
      }
    })

    return NextResponse.json({
      success: true,
      entry: {
        ...historyEntry,
        metadata: historyEntry.metadata ? JSON.parse(historyEntry.metadata) : null
      }
    })
  } catch (error) {
    console.error("Error saving history:", error)
    return NextResponse.json(
      { error: "Failed to save history" },
      { status: 500 }
    )
  }
}

// DELETE - Clear history (optional)
export async function DELETE(req: Request) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    await prisma.slideHistory.deleteMany({
      where: {
        userId: session.user.id
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error clearing history:", error)
    return NextResponse.json(
      { error: "Failed to clear history" },
      { status: 500 }
    )
  }
}
