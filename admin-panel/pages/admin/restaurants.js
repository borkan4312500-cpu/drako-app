import { useState, useEffect } from "react";
import { useRouter } from "next/router";

export default function RestaurantsPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [restaurants, setRestaurants] = useState([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const savedToken = localStorage.getItem("drako_token");
    if (!savedToken) {
      router.push("/admin");
      return;
    }
    setToken(savedToken);
    loadRestaurants(savedToken);
  }, []);

  const loadRestaurants = async (tok) => {
    try {
      const res = await fetch("http://localhost:4000/api/admin/restaurants", {
        headers: { Authorization: "Bearer " + tok },
      });
      const data = await res.json();
      if (data.error) {
        setMsg("خطأ: " + data.error);
      } else {
        setRestaurants(data);
        setMsg("");
      }
    } catch (err) {
      setMsg("فشل الاتصال بالسيرفر. تأكد أنه يعمل على المنفذ 4000.");
    }
  };

  const addRestaurant = async () => {
    if (!name || !phone || !password) {
      setMsg("الرجاء ملء جميع الحقول");
      return;
    }
    try {
      const res = await fetch("http://localhost:4000/api/admin/restaurants", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ name, ownerPhone: phone, ownerPassword: password }),
      });
      const data = await res.json();
      if (data.error) {
        setMsg("خطأ: " + data.error);
      } else {
        setName(""); setPhone(""); setPassword("");
        setMsg("تمت إضافة المطعم بنجاح");
        loadRestaurants(token);
      }
    } catch (err) {
      setMsg("فشل الاتصال بالسيرفر. تأكد أنه يعمل على المنفذ 4000.");
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>🍽️ إدارة المطاعم</h1>
      {msg && <div style={{ background: '#fef2f2', padding: 10, margin: '10px 0', borderRadius: 8, color: '#b91c1c' }}>{msg}</div>}
      <div style={{ margin: "20px 0", display: "flex", gap: 10 }}>
        <input placeholder="اسم المطعم" value={name} onChange={e => setName(e.target.value)} />
        <input placeholder="هاتف المالك" value={phone} onChange={e => setPhone(e.target.value)} />
        <input placeholder="كلمة المرور" value={password} onChange={e => setPassword(e.target.value)} />
        <button onClick={addRestaurant}>إضافة</button>
      </div>
      <table>
        <thead><tr><th>الاسم</th><th>المالك</th><th>الحالة</th></tr></thead>
        <tbody>
          {restaurants.map(r => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.ownerName} ({r.ownerPhone})</td>
              <td>{r.isOpen ? "مفتوح" : "مغلق"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <style jsx>{`
        input { padding: 8px; border: 1px solid #ddd; border-radius: 8px; }
        button { background: #FF6B00; color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #eee; padding: 12px; text-align: right; }
        th { background: #FF6B00; color: white; }
      `}</style>
    </div>
  );
}
