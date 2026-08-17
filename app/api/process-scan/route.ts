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
    // קריאה של הבקשה פעם אחת בלבד (זה מה שגרם לקריסה קודם!)
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

    const prompt = `אתה מנתח קבלות סופרמרקט בישראל בעברית.
חלץ את שם הסופר/חנות, את כל הפריטים והמחיר של כל פריט, וסווג כל פריט לאחת מ-3 קטגוריות בלבד: "vegan", "non_vegan", "general".
החזר אך ורק תשובת JSON תקינה במבנה הבא (ללא שום טקסט נוסף וללא תגיות markdown):
{ "store_name": "שם הסופר", "items": [ { "name": "שם המוצר", "price": 12.5, "category": "vegan" } ], "total_amount": 100 }`;

    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest', 
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { data: base64Data, mimeType } }] }],
      config: { responseMimeType: 'application/json' }
    });

    let text = response.text || '{}';
    if (text.startsWith('```json')) text = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    else if (text.startsWith('```')) text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');

    const parsedData = JSON.parse(text);

    await supabase.from('receipt_scans').update({
      status: 'completed',
      result_data: parsedData
    }).eq('id', currentScanId);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Background Process Error:', error);
    // עכשיו הקוד יכול לעדכן את המסד בביטחה שקרתה שגיאה
    if (currentScanId) {
      await supabase.from('receipt_scans').update({ 
        status: 'error',
        result_data: { error_message: error.message }
      }).eq('id', currentScanId);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}