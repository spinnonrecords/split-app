'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { calculateSplits, Roommate, ReceiptItem } from '@/lib/split-logic';
import { Upload, ShoppingBag, DollarSign, History, Trash2, Image as ImageIcon, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export default function Home() {
  const [roommates, setRoommates] = useState<Roommate[]>([]);
  const [payerId, setPayerId] = useState<string>('');
  
  const [isUploading, setIsUploading] = useState(false);
  const [scansQueue, setScansQueue] = useState<any[]>([]);
  
  // State for active review (when clicking on a completed scan)
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState('');
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);
  
  const [balances, setBalances] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    fetchRoommates();
    fetchBalances();
    fetchHistory();
    fetchQueue();

    // דגימה כל 5 שניות לבדוק אם קבלה סיימה עיבוד ברקע
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchRoommates() {
    const { data } = await supabase.from('roommates').select('*').order('created_at', { ascending: true });
    if (data && data.length > 0) {
      setRoommates(data);
      setPayerId(data[0].id);
    }
  }

  async function fetchQueue() {
    const { data } = await supabase
      .from('receipt_scans')
      .select('*, payer:payer_id ( name )')
      .order('created_at', { ascending: false });
    setScansQueue(data || []);
  }

async function fetchBalances() {
    const { data } = await supabase.from('debt_shares').select(`
      amount_owed, debtor:debtor_id ( name, is_vegan ), expense:expense_id ( payer:payer_id ( name, is_vegan ) )
    `);
    const aggregatedBalances: Record<string, any> = {};
    
    // הוספנו כאן (b: any) וסימני שאלה כדי ש-TypeScript לא יקרוס
    data?.forEach((b: any) => {
      const debtorName = b.debtor?.name || 'לא ידוע';
      const payerName = b.expense?.payer?.name || 'לא ידוע';
      const key = `${debtorName}-${payerName}`;
      
      if (!aggregatedBalances[key]) aggregatedBalances[key] = { ...b, amount_owed: 0 };
      aggregatedBalances[key].amount_owed += Number(b.amount_owed);
    });
    
    setBalances(Object.values(aggregatedBalances).filter((b: any) => b.amount_owed > 0));
  }

  async function fetchHistory() {
    const { data } = await supabase
      .from('expenses')
      .select(`id, created_at, store_name, total_amount, receipt_image_url, payer:payer_id ( name, is_vegan ), items:expense_items ( name, price, category )`)
      .order('created_at', { ascending: false });
    setHistory(data || []);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !payerId) return;

    setIsUploading(true);
    
    // 1. העלאת התמונה ל-Storage
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from('receipts').upload(fileName, file);

    if (uploadError) {
      alert('שגיאה בהעלאת התמונה');
      setIsUploading(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from('receipts').getPublicUrl(fileName);

    // 2. יצירת רשומה בתור (Queue)
    const { data: scanRecord, error: dbError } = await supabase.from('receipt_scans').insert({
      payer_id: payerId,
      image_url: publicUrl,
      status: 'pending'
    }).select().single();

    if (dbError || !scanRecord) {
      alert('שגיאה ביצירת תור סריקה');
      setIsUploading(false);
      return;
    }

    // 3. שליחת בקשה "שגר ושכח"
    fetch('/api/process-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId: scanRecord.id }),
    }).catch(console.error); 

    setIsUploading(false);
    fetchQueue(); 
    alert('הקבלה הועלתה ונכנסה לתור הסריקה! תוכל לחזור אליה כשתהיה מוכנה.');
  }

  const reviewScan = (scan: any) => {
    setActiveScanId(scan.id);
    setPayerId(scan.payer_id);
    setReceiptImageUrl(scan.image_url);
    
    if (scan.result_data) {
      setStoreName(scan.result_data.store_name || 'קנייה בסופר');
      setItems(scan.result_data.items || []);
    }
  };

  const discardScan = async (scanId: string) => {
    if (!confirm('למחוק את הסריקה הזו?')) return;
    await supabase.from('receipt_scans').delete().eq('id', scanId);
    if (activeScanId === scanId) setActiveScanId(null);
    fetchQueue();
  };

  const updateItemCategory = (index: number, category: ReceiptItem['category']) => {
    const updated = [...items];
    updated[index].category = category;
    setItems(updated);
  };

  async function saveExpense() {
    if (!payerId || items.length === 0 || !activeScanId) return;

    const totalAmount = items.reduce((sum, item) => sum + Number(item.price), 0);
    const { debts } = calculateSplits(items, roommates, payerId);

    const { data: expense, error } = await supabase.from('expenses').insert({
      payer_id: payerId, store_name: storeName, total_amount: totalAmount, receipt_image_url: receiptImageUrl
    }).select().single();

    if (error || !expense) return alert('שגיאה בשמירת ההוצאה');

    await supabase.from('expense_items').insert(
      items.map(item => ({ expense_id: expense.id, name: item.name, price: item.price, category: item.category }))
    );

    await supabase.from('debt_shares').insert(
      debts.map(d => ({ expense_id: expense.id, debtor_id: d.debtor_id, amount_owed: d.amount }))
    );

    // מחיקת הקבלה מהתור אחרי אישור
    await supabase.from('receipt_scans').delete().eq('id', activeScanId);

    alert('✅ הקבלה אושרה ונשמרה בהצלחה!');
    setActiveScanId(null);
    setItems([]);
    fetchBalances();
    fetchHistory();
    fetchQueue();
  }

  async function deleteExpense(expenseId: string) {
    if (!confirm('האם למחוק הוצאה זו? פעולה זו תבטל את החובות הקשורים אליה.')) return;
    
    await supabase.from('expenses').delete().eq('id', expenseId);
    
    fetchBalances();
    fetchHistory();
  }

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-8 font-sans text-slate-800" dir="rtl">
      <header className="text-center mb-8">
        <h1 className="text-3xl font-bold text-emerald-700">🛒 VeganSplit</h1>
        <p className="text-slate-500 mt-1">חלוקת קניות חכמה ברקע 🌱</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* העלאת קבלה חדשה */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5 text-emerald-600" /> זרוק קבלה לתור
          </h2>
          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">מי שילם?</label>
              <select value={payerId} onChange={e => setPayerId(e.target.value)} className="w-full border rounded-xl p-2.5 bg-slate-50">
                {roommates.map(r => <option key={r.id} value={r.id}>{r.name} {r.is_vegan ? '🌱' : ''}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">תמונת קבלה</label>
              <input type="file" accept="image/*" capture="environment" onChange={handleFileUpload} disabled={isUploading}
                className="w-full text-sm file:ml-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 disabled:opacity-50" />
            </div>
          </div>
          {isUploading && <p className="text-emerald-600 font-medium animate-pulse text-sm">מעלה את התמונה לשרת...</p>}
        </section>

        {/* תור קבלות */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 bg-slate-50/50">
          <h2 className="text-lg font-semibold mb-4 flex items-center justify-between">
            תור סריקות
            <span className="bg-slate-200 text-slate-700 text-xs px-2 py-1 rounded-full">{scansQueue.length}</span>
          </h2>
          {scansQueue.length === 0 ? (
            <p className="text-sm text-slate-400">התור ריק. הכל נקי! ✨</p>
          ) : (
            <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
              {scansQueue.map(scan => (
                <div key={scan.id} className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-500 mb-1">{new Date(scan.created_at).toLocaleTimeString('he-IL')} • {scan.payer?.name}</p>
                    {scan.status === 'pending' || scan.status === 'processing' ? (
                      <div className="flex items-center gap-1 text-blue-600 text-sm font-medium"><Loader2 className="w-4 h-4 animate-spin" /> סורק...</div>
                    ) : scan.status === 'error' ? (
                      <div className="flex items-center gap-1 text-rose-600 text-sm font-medium"><AlertCircle className="w-4 h-4" /> שגיאה בסריקה</div>
                    ) : (
                      <button onClick={() => reviewScan(scan)} className="flex items-center gap-1 text-emerald-600 hover:text-emerald-700 text-sm font-bold transition"><CheckCircle2 className="w-4 h-4" /> סריקה מוכנה! לחץ לאישור</button>
                    )}
                  </div>
                  <button onClick={() => discardScan(scan.id)} className="text-slate-400 hover:text-rose-500 p-1"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* אזור אישור קבלה שסיימה סריקה */}
      {activeScanId && items.length > 0 && (
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-200 ring-2 ring-emerald-50 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2 text-emerald-800">
              <ShoppingBag className="w-6 h-6 text-emerald-600" /> סקירה ואישור: {storeName}
            </h2>
            <div className="flex gap-2">
               {receiptImageUrl && <a href={receiptImageUrl} target="_blank" rel="noreferrer" className="text-sm bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-xl font-medium flex items-center gap-2 transition"><ImageIcon className="w-4 h-4" /> צפה בתמונה</a>}
               <span className="text-sm bg-emerald-100 text-emerald-800 px-4 py-2 rounded-xl font-bold">סה"כ: ₪{items.reduce((s, i) => s + Number(i.price), 0).toFixed(2)}</span>
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto mb-6 bg-slate-50 rounded-xl p-2">
            {items.map((item, idx) => (
              <div key={idx} className="py-3 px-2 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex-1">
                  <p className="font-semibold text-sm">{item.name}</p>
                  <p className="text-sm text-slate-600">₪{Number(item.price).toFixed(2)}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => updateItemCategory(idx, 'vegan')} className={`px-3 py-1.5 text-xs rounded-lg font-bold transition ${item.category === 'vegan' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200'}`}>🌱 טבעוני</button>
                  <button onClick={() => updateItemCategory(idx, 'non_vegan')} className={`px-3 py-1.5 text-xs rounded-lg font-bold transition ${item.category === 'non_vegan' ? 'bg-rose-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200'}`}>🥩 מהחי</button>
                  <button onClick={() => updateItemCategory(idx, 'general')} className={`px-3 py-1.5 text-xs rounded-lg font-bold transition ${item.category === 'general' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200'}`}>🧼 כללי</button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button onClick={() => setActiveScanId(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-3 rounded-xl transition">סגור בינתיים</button>
            <button onClick={saveExpense} className="flex-2 w-2/3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition shadow-sm">אשר קבלה וחלק חובות</button>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* מאזן חובות */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            מאזן חובות כולל
          </h2>
          {balances.length === 0 ? (
            <p className="text-sm text-slate-400">הכל מקוזז, אין חובות! 🎉</p>
          ) : (
            <div className="space-y-3">
              {balances.map((b, i) => (
                <div key={i} className="flex justify-between items-center p-3 bg-rose-50 rounded-xl text-sm border border-rose-100">
                  <span>
                    <strong className="text-slate-900">{b.debtor?.name}</strong> חייב/ת ל-
                    <strong className="text-slate-900">{b.expense?.payer?.name}</strong>
                  </span>
                  <span className="font-bold text-rose-600">₪{Number(b.amount_owed).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* היסטוריית הוצאות */}
        <section className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-600" />
            היסטוריית קניות
          </h2>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400">אין עדיין קניות בהיסטוריה.</p>
          ) : (
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
              {history.map(expense => (
                <div key={expense.id} className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="font-semibold text-slate-800">{expense.store_name}</h3>
                      <p className="text-xs text-slate-500">
                        {new Date(expense.created_at).toLocaleDateString('he-IL')} • {expense.payer?.name} שילם/ה
                      </p>
                    </div>
                    <span className="font-bold text-emerald-600">₪{Number(expense.total_amount).toFixed(2)}</span>
                  </div>
                  
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-200">
                    {expense.receipt_image_url ? (
                      <a href={expense.receipt_image_url} target="_blank" rel="noreferrer" className="text-xs flex items-center gap-1 text-blue-600 hover:underline">
                        <ImageIcon className="w-4 h-4" /> צפה בקבלה
                      </a>
                    ) : (
                      <span className="text-xs text-slate-400">אין תמונה</span>
                    )}
                    
                    <button 
                      onClick={() => deleteExpense(expense.id)}
                      className="text-xs flex items-center gap-1 text-slate-500 hover:text-rose-600 transition"
                      title="מחק הוצאה (יבטל את החובות שלה)"
                    >
                      <Trash2 className="w-4 h-4" /> מחק / בטל
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}