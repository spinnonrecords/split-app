import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

// פקודה מיוחדת ל-Vercel: תן לשרת לעבוד עד 60 שניות לפני שאתה קוטע אותו (במקום 10-15)
export const maxDuration = 60;

// חיבור ל-Supabase מאחורי הקלעים
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { scanId } = await req.json();
    if (!scanId) return NextResponse.json({ error: 'חסר ID' }, { status: 400 });

    // 1. מעדכנים סטטוס ל"בעיבוד"
    await supabase.from('receipt_scans').update({ status: 'processing' }).eq('id', scanId);

    // 2. שולפים את נתוני הקבלה מהתור
    const { data: scanItem } = await supabase.from('receipt_scans').select('*').eq('id', scanId).single();
    if (!scanItem) throw new Error('הקבלה לא נמצאה');

    // 3. מורידים את התמונה מהקישור של Supabase כדי לשלוח ל-Gemini
    const imageRes = await fetch(scanItem.image_url);
    const arrayBuffer = await imageRes.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';

    // 4. שולחים לג'מיני
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

    // 5. שומרים את התוצאה במסד הנתונים ומשנים סטטוס ל"הושלם"
    await supabase.from('receipt_scans').update({
      status: 'completed',
      result_data: parsedData
    }).eq('id', scanId);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Background Process Error:', error);
    // במקרה של שגיאה, נעדכן את הסטטוס כדי שהמשתמש ידע שמשהו השתבש
    const { scanId } = await req.json().catch(() => ({}));
    if (scanId) {
      await supabase.from('receipt_scans').update({ status: 'error' }).eq('id', scanId);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}