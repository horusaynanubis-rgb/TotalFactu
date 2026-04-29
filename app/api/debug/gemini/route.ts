import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Protect with DEBUG_SECRET env var — pass as ?secret=XXX
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.DEBUG_SECRET;
  if (!secret) return false; // disabled if no secret configured
  return request.nextUrl.searchParams.get('secret') === secret;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized. Set DEBUG_SECRET in env and pass ?secret=XXX' }, { status: 401 });
  }

  const result: Record<string, any> = {};

  // 1. Check env vars (never expose the key value)
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';
  result.gemini_api_key_present = !!apiKey;
  result.gemini_api_key_length = apiKey?.length ?? 0;
  result.gemini_model = model;
  result.force_local_ai = process.env.FORCE_LOCAL_AI ?? null;
  result.ai_force_local = process.env.AI_FORCE_LOCAL ?? null;

  if (!apiKey) {
    return NextResponse.json({ ...result, ok: false, error: 'GEMINI_API_KEY is not set' });
  }

  // 2. Make a minimal text-only call to Gemini to verify connectivity
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  try {
    const body = {
      contents: [{ parts: [{ text: 'Reply with exactly the word: OK' }] }],
      generationConfig: { maxOutputTokens: 10 },
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    result.gemini_http_status = response.status;

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      result.ok = false;
      result.gemini_error = errorText.slice(0, 500);
      return NextResponse.json(result);
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    result.ok = true;
    result.gemini_response = content;
    result.finish_reason = data?.candidates?.[0]?.finishReason ?? null;
  } catch (err: any) {
    result.ok = false;
    result.gemini_error = err?.message ?? 'unknown error';
  }

  return NextResponse.json(result);
}
