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

  async function runBrowserScan(scanId: string, imageUrl: string) {
    const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY!);
    const models = ["gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-2.5-flash"];
    
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const reader = new FileReader();
    
    reader.onloadend = async () => {
      const base64Data = (reader.result as string).split(',')[1];
      let success = false;

      for (const modelName of models) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent([
            "נתח את הקבלה. החזר JSON: { 'store_name': '...', 'items': [{'name': '...', 'price': 0, 'category': 'vegan' | 'non_vegan' | 'general'}], 'total_amount': 0 }",
            { inlineData: { data: base64Data, mimeType: blob.type } }
          ]);
          const json = JSON.parse(result.response.text().replace(/```json|```/g, ''));
          await fetch('/api/process-scan', { method: 'POST', body: JSON.stringify({ scanId, resultData: json }) });
          loadData();
          success = true; break;
        } catch (e) { console.warn(`מודל ${modelName} נכשל, מנסה הבא...`); }
      }
      if (!success) {
        await supabase.from('receipt_scans').update({ status: 'error' }).eq('id', scanId);
        loadData();
      }
    };
    reader.readAsDataURL(blob);
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

  async function saveEditedExpense() {
    const total = editItems.reduce((s, i) => s + Number(i.price), 0);
    const { debts } = calculateSplits(editItems, roommates, editingExpense.payer_id);
    await supabase.from('expenses').update({ total_amount: total }).eq('id', editingExpense.id);
    await supabase.from('expense_items').delete().eq('expense_id', editingExpense.id);
    await supabase.from('expense_items').insert(editItems.map(i => ({ expense_id: editingExpense.id, name: i.name, price: i.price, category: i.category })));
    await supabase.from('debt_shares').delete().eq('expense_id', editingExpense.id);
    await supabase.from('debt_shares').insert(debts.map(d => ({ expense_id: editingExpense.id, debtor_id: d.debtor_id, amount_owed: d.amount })));
    setEditingExpense(null); loadData(); alert('עודכן!');
  }

  return (
    <main className="max-w-4xl mx-auto p-4" dir="rtl">
      <h1 className="text-3xl font-bold text-center mb-8">🛒 VeganSplit</h1>
      <input type="file" onChange={handleFileUpload} className="mb-4 block" />
      
      <section className="bg-white p-6 rounded-2xl shadow mb-8">
        <h2 className="font-bold mb-4">היסטוריית קניות</h2>
        {history.map(ex => (
          <div key={ex.id} className="flex justify-between items-center p-3 border-b">
            <span>{ex.store_name} - ₪{ex.total_amount}</span>
            <button onClick={() => { setEditingExpense(ex); setEditItems(ex.items); }} className="text-emerald-600 flex items-center gap-1"><Edit3 size={16}/> ערוך</button>
          </div>
        ))}
      </section>

      {editingExpense && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-2xl w-full max-w-lg">
            <h2 className="text-xl font-bold mb-4">עריכת {editingExpense.store_name}</h2>
            {editItems.map((item, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <input className="border p-1 rounded flex-1" value={item.name} onChange={(e) => { const n = [...editItems]; n[idx].name = e.target.value; setEditItems(n); }} />
                <input className="border p-1 rounded w-20" type="number" value={item.price} onChange={(e) => { const n = [...editItems]; n[idx].price = e.target.value; setEditItems(n); }} />
              </div>
            ))}
            <div className="flex gap-2 mt-4">
              <button onClick={saveEditedExpense} className="bg-emerald-600 text-white px-4 py-2 rounded">שמור</button>
              <button onClick={() => setEditingExpense(null)} className="bg-slate-200 px-4 py-2 rounded">ביטול</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}