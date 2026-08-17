import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: 'חסר מפתח GEMINI_API_KEY' }, { status: 500 });
    }

    const ai = new GoogleGenAI({ apiKey: apiKey });

    const formData = await req.formData();
    const file = formData.get('receipt') as File;

    if (!file) {
      return NextResponse.json({ error: 'לא הועלתה תמונה' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const base64Data = Buffer.from(bytes).toString('base64');
    const mimeType = file.type || 'image/jpeg';

    const prompt = `
אתה מנתח קבלות סופרמרקט בישראל בעברית.
חלץ את שם הסופר/חנות, את כל הפריטים והמחיר של כל פריט, וסווג כל פריט לאחת מ-3 קטגוריות בלבד:
1. "vegan": מוצרים טבעוניים / פרווה (ירקות, פירות, טופו, משקאות צמחיים, לחם, קטניות, חטיפים טבעוניים וכו').
2. "non_vegan": מוצרים מן החי (חלב, גבינות, יוגורט, חמאה, ביצים, בשר, עוף, דגים וכו').
3. "general": מוצרי ניקיון, טואלטיקה ובית (סבון, שמפו, שקיות, נייר טואלט וכו').

החזר אך ורק תשובת JSON תקינה במבנה הבא (ללא שום טקסט נוסף וללא תגיות markdown):
{
  "store_name": "שם הסופר",
  "items": [
    { "name": "שם המוצר", "price": 12.5, "category": "vegan" }
  ],
  "total_amount": 100
}
`;

    // הפניה למודל העדכני ביותר שפתוח למשתמשים חדשים לפי הרשימה שלך
    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
      }
    });

    let text = response.text || '{}';

    if (text.startsWith('```json')) {
      text = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (text.startsWith('```')) {
      text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(text);
    return NextResponse.json(parsed);

  } catch (error: any) {
    console.error('GenAI API Error:', error);
    return NextResponse.json({ error: error.message || 'שגיאת שרת כללית' }, { status: 500 });
  }
}