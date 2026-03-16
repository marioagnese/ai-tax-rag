import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    console.log("Autosave payload:", body);

    return NextResponse.json({
      success: true
    });

  } catch (error) {
    return NextResponse.json(
      { error: "Autosave failed" },
      { status: 500 }
    );
  }
}