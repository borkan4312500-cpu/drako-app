import { useState, useEffect } from "react";
import { useRouter } from "next/router";

export default function DriversPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [drivers, setDrivers] = useState([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const savedToken = localStorage.getItem("drako_token");
    if (!savedToken) { router.push("/admin"); return; }
    setToken(savedToken);
    loadDrivers(savedToken);
  }, []);

  const loadDrivers = async (tok) => {
    const res = await fetch("http://localhost:4000/api/admin/drivers", {
      headers: { Authorization: "Bearer " + tok }
    });
    const data = await res.json();
    setDrivers(data);
  };

  const addDriver = async () => {
    await fetch("http://localhost:4000/api/admin/drivers", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ name, phone, password })
    });
    setName(""); setPhone(""); setPassword("");
    loadDrivers(token);
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>🛵 إدارة الطيارين</h1>
      <div style={{ margin: "20px 0" }}>
        <input placeholder="الاسم" value={name} onChange={e => setName(e.target.value)} />
        <input placeholder="الهاتف" value={phone} onChange={e => setPhone(e.target.value)} />
        <input placeholder="كلمة المرور" value={password} onChange={e => setPassword(e.target.value)} />
        <button onClick={addDriver}>إضافة</button>
      </div>
      <table>
        <thead><tr><th>الاسم</th><th>الهاتف</th><th>الأرباح</th><th>الحالة</th></tr></thead>
        <tbody>
          {drivers.map(d => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td>{d.phone}</td>
              <td>{d.earnings || 0} ج.م</td>
              <td>{d.isActive ? "نشط" : "موقوف"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <style jsx>{`
        input { margin: 0 5px; padding: 8px; border: 1px solid #ddd; border-radius: 8px; }
        button { background: #FF6B00; color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #eee; padding: 12px; text-align: right; }
        th { background: #FF6B00; color: white; }
      `}</style>
    </div>
  );
}
