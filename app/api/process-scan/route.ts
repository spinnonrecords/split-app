import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  let currentScanId = null;
  try {
    const body = await req.json();
    currentScanId = body.scanId;
    if (!currentScanId) return NextResponse.json({ error: 'חסר ID' }, { status: 400 });

    await supabase.from('receipt_scans').update({ status: 'processing' }).eq('id', currentScanId);

    const { data: scanItem } = await supabase.from('receipt_scans').select('*').eq('id', currentScanId).single();
    if (!scanItem) throw new Error('הקבלה לא נמצאה');

    const imageRes = await fetch(scanItem.image_url);
    const arrayBuffer = await imageRes.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `אתה מנתח קבלות סופרמרקט בישראל. החזר JSON בלבד: { "store_name": "...", "items": [ { "name": "...", "price": 0, "category": "vegan" | "non_vegan" | "general" } ], "total_amount": 0 }`;

    const modelsToTry = ['gemini-flash-latest', 'gemini-1.5-flash', 'gemini-pro'];
    let responseText = '';
    let success = false;
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { data: base64Data, mimeType } }] }],
          config: { responseMimeType: 'application/json' }
        });
        responseText = response.text || '{}';
        success = true;
        break;
      } catch (err: any) { lastError = err; }
    }

    if (!success) throw lastError;

    const parsedData = JSON.parse(responseText.replace(/^```json\s*/, '').replace(/\s*```$/, ''));
    await supabase.from('receipt_scans').update({ status: 'completed', result_data: parsedData }).eq('id', currentScanId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (currentScanId) await supabase.from('receipt_scans').update({ status: 'error', result_data: { error_message: error.message } }).eq('id', currentScanId);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}