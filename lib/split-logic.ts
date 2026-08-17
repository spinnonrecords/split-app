export interface Roommate {
  id: string;
  name: string;
  is_vegan: boolean;
}

export interface ReceiptItem {
  name: string;
  price: number;
  category: 'vegan' | 'non_vegan' | 'general';
}

export function calculateSplits(items: ReceiptItem[], roommates: Roommate[], payerId: string) {
  const totalRoommates = roommates.length;
  const nonVegans = roommates.filter(r => !r.is_vegan);
  const totalNonVegans = nonVegans.length;

  const shares: Record<string, number> = {};
  roommates.forEach(r => (shares[r.id] = 0));

  items.forEach(item => {
    const price = Number(item.price);
    if (item.category === 'general' || item.category === 'vegan') {
      const splitAmount = price / totalRoommates;
      roommates.forEach(r => (shares[r.id] += splitAmount));
    } else if (item.category === 'non_vegan') {
      if (totalNonVegans > 0) {
        const splitAmount = price / totalNonVegans;
        nonVegans.forEach(r => (shares[r.id] += splitAmount));
      }
    }
  });

  const debts = roommates
    .filter(r => r.id !== payerId)
    .map(r => ({
      debtor_id: r.id,
      amount: Number((shares[r.id] || 0).toFixed(2))
    }));

  return { shares, debts };
}