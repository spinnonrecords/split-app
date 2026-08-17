'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { calculateSplits } from '@/lib/split-logic';
import { Upload, ShoppingBag, History, Trash2, Edit3, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { GoogleGenerativeAI } from "@google/generative-ai";

export default function Home() {
  const [roommates, setRoommates] = useState<any[]>([]);
  const [payerId, setPayerId] = useState('');
  const [scansQueue, setScansQueue] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [editItems, setEditItems] = useState<any[]>([]);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [{ data: r }, { data: s }, { data: h }] = await Promise.all([
      supabase.from('roommates').select('*'),
      supabase.from('receipt_scans').select('*, payer:payer_id (name)'),
      supabase.from('expenses').select(`*, payer:payer_id (name), items:expense_items (*)`)
    ]);
    setRoommates(r || []); setScansQueue(s || []); setHistory(h || []);
    if (r?.length && !payerId) setPayerId(r[0].id);
  }

  // ניתוח תמונה ישירות מהדפדפן
  async function runBrowserScan(scanId: string, imageUrl: string) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY!);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const reader = new FileReader();
      
      reader.onloadend = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        const result = await model.generateContent([
          "נתח את הקבלה. החזר JSON תקין (ללא markdown): { 'store_name': '...', 'items': [{'name': '...', 'price': 0, 'category': 'vegan' | 'non_vegan' | 'general'}], 'total_amount': 0 }",
          { inlineData: { data: base64Data, mimeType: blob.type } }
        ]);
        const json = JSON.parse(result.response.text().replace(/```json|```/g, ''));
        await fetch('/api/process-scan', { method: 'POST', body: JSON.stringify({ scanId, resultData: json }) });
        loadData();
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      await supabase.from('receipt_scans').update({ status: 'error' }).eq('id', scanId);
      loadData();
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !payerId) return;
    const fileName = `${Date.now()}.jpg`;
    await supabase.storage.from('receipts').upload(fileName, file);
    const { data: { publicUrl } } = supabase.storage.from('receipts').getPublicUrl(fileName);
    const { data: scan } = await supabase.from('receipt_scans').insert({ payer_id: payerId, image_url: publicUrl, status: 'pending' }).select().single();
    runBrowserScan(scan.id, publicUrl);
    loadData();
  }

  return (
    <main className="max-w-4xl mx-auto p-4" dir="rtl">
      <h1 className="text-2xl font-bold text-center mb-6">🛒 VeganSplit</h1>
      
      <section className="bg-white p-4 rounded-xl shadow border mb-6">
        <label>העלאת קבלה:</label>
        <input type="file" onChange={handleFileUpload} />
      </section>

      <section className="bg-white p-4 rounded-xl shadow border">
        <h2 className="font-bold mb-4">תור סריקות</h2>
        {scansQueue.map(s => (
          <div key={s.id} className="flex justify-between border-b py-2">
            {s.status === 'pending' ? <Loader2 className="animate-spin text-blue-500"/> : s.status}
            {s.status === 'error' && <button onClick={() => runBrowserScan(s.id, s.image_url)} className="text-red-500">נסה שוב</button>}
          </div>
        ))}
      </section>
    </main>
  );
}