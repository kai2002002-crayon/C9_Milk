import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, query, where, getDocs, serverTimestamp, deleteDoc, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import oldProducts from './products.js'; 

const firebaseConfig = {
  apiKey: "AIzaSyATCX2DDrRgRMtKCeslfSz5nEXEd_mqA7U",
  authDomain: "c9milk-bd868.firebaseapp.com",
  projectId: "c9milk-bd868",
  storageBucket: "c9milk-bd868.firebasestorage.app",
  messagingSenderId: "766220739285",
  appId: "1:766220739285:web:68ba76af551d9f1ae9785c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const ADMIN_EMAILS = ["kai2002002@gmail.com", "drelingp@gmail.com"];

let currentUser = null;
let cart = JSON.parse(localStorage.getItem('drink_cart')) || [];
let userPurchaseHistory = new Set();
let dynamicProducts = []; 
let allOrdersCache = []; 
let editingOrderId = null;

// ==========================================
// 週期與截單計算邏輯
// ==========================================
// 判斷訂單屬於哪個月份週期 (跨過截單日算下個月)
function getOrderCycleMonth(millis) {
    const d = new Date(millis);
    const y = d.getFullYear(), m = d.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    const cutoffTime = new Date(y, m, lastDay - 2, 0, 0, 0).getTime();
    
    if (d.getTime() >= cutoffTime) {
        const next = new Date(y, m + 1, 1);
        return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    }
    return `${y}-${String(m + 1).padStart(2, '0')}`;
}

// 判斷此訂單是否已經過了其所屬週期的截單日 (過了就鎖定)
function isOrderLocked(millis) {
    if (!millis) return false;
    const now = new Date();
    const d = new Date(millis);
    const y = d.getFullYear(), m = d.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    const cutoffTime = new Date(y, m, lastDay - 2, 0, 0, 0).getTime();
    
    if (d.getTime() >= cutoffTime) {
        // 屬於下個月週期，用下個月的截單日算
        const nextLastDay = new Date(y, m + 2, 0).getDate();
        const nextCutoffTime = new Date(y, m + 1, nextLastDay - 2, 0, 0, 0).getTime();
        return now.getTime() >= nextCutoffTime;
    }
    return now.getTime() >= cutoffTime;
}
// ==========================================
// 計算並顯示下一期截單日
// ==========================================
function displayCutoffDate() {
    const now = new Date();
    let y = now.getFullYear();
    let m = now.getMonth();
    
    // 計算這個月的最後一天與截單日
    let lastDay = new Date(y, m + 1, 0).getDate();
    let cutoffDay = lastDay - 2;
    
    // 如果今天已經「超過」本月截單日 (例如今天是30號，截單是29號)
    // 則顯示下個月的截單日
    if (now.getDate() > cutoffDay) {
        m++;
        if (m > 11) {
            m = 0;
            y++;
        }
        // 重新計算下個月的截單日
        lastDay = new Date(y, m + 1, 0).getDate();
        cutoffDay = lastDay - 2;
    }
    
    const displayEl = document.getElementById('cutoffDateDisplay');
    if (displayEl) {
        // 顯示格式：YYYY年MM月DD日 晚上 11:50 (搭配之前 Vercel Cron 的設定)
        displayEl.innerText = `${y}年${m + 1}月${cutoffDay}日 晚上 11:50`;
    }
}

// ==========================================
// 基礎操作
// ==========================================
window.showSection = (sectionId) => {
    ['login', 'products', 'cart', 'history', 'admin'].forEach(id => {
        document.getElementById(id + 'Section').style.display = 'none';
    });
    document.getElementById(sectionId + 'Section').style.display = 'block';

    if (sectionId === 'history') loadOrderHistory();
    if (sectionId === 'admin') {
        window.switchAdminTab('orders');
        loadAllOrdersForAdmin();
    }
};

document.getElementById('loginBtn').addEventListener('click', () => signInWithPopup(auth, provider));
document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth).then(() => { cart = []; updateCartUI(); }));

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('navLinks').style.display = 'flex';
        document.getElementById('userName').value = user.displayName; 
        document.getElementById('adminNavBtn').style.display = ADMIN_EMAILS.includes(user.email) ? 'inline-block' : 'none';

        await loadUserPurchaseHistory(); 
        await loadProductsFromDB();
        renderProducts(dynamicProducts); 
        updateCartUI(); 
        displayCutoffDate();
        window.showSection('products');
    } else {
        currentUser = null;
        document.getElementById('navLinks').style.display = 'none';
        window.showSection('login');
    }
});

async function loadProductsFromDB() {
    const snap = await getDocs(collection(db, "products"));
    dynamicProducts = [];
    snap.forEach(doc => dynamicProducts.push(doc.data()));
}

async function loadUserPurchaseHistory() {
    userPurchaseHistory.clear();
    const snap = await getDocs(query(collection(db, "orders"), where("uid", "==", currentUser.uid)));
    snap.forEach(doc => doc.data().items.forEach(item => userPurchaseHistory.add(item.code)));
}

document.getElementById('searchInput').addEventListener('input', (e) => {
    const k = e.target.value.toLowerCase().trim();
    renderProducts(dynamicProducts.filter(p => p.name.toLowerCase().includes(k) || p.code.toLowerCase().includes(k)));
});

function renderProducts(productList) {
    const tbody = document.getElementById('productList');
    tbody.innerHTML = '';
    
    [...productList].sort((a, b) => {
        if (userPurchaseHistory.has(a.code) && !userPurchaseHistory.has(b.code)) return -1;
        if (!userPurchaseHistory.has(a.code) && userPurchaseHistory.has(b.code)) return 1;
        return a.code.localeCompare(b.code, undefined, {numeric: true});
    }).forEach(p => {
        const row = document.createElement('div');
        row.className = `flex flex-col md:flex-row md:items-center p-4 gap-2 hover:bg-gray-50 border-b ${userPurchaseHistory.has(p.code) ? 'bg-green-50' : ''}`;
        row.innerHTML = `
            <div class="flex items-start md:items-center gap-3 flex-1">
                <div class="w-16 text-sm text-gray-500">${p.code}</div>
                <div class="flex-1 font-medium text-gray-800">${p.name} ${userPurchaseHistory.has(p.code) ? '⭐' : ''}</div>
                <div class="w-24 text-sm text-gray-500">${p.packing}</div>
            </div>
            <div class="flex items-center justify-end gap-3 w-full md:w-auto mt-2 md:mt-0">
                <div class="w-20 text-green-700 font-bold text-right">$${p.price}</div>
                <select id="qty-${p.code}" class="border rounded px-2 py-1 w-16 text-center">
                    ${[0,1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}">${n}</option>`).join('')}
                </select>
                <button onclick="addToCart('${p.code}')" class="bg-green-600 text-white px-4 py-1.5 rounded text-sm">加入</button>
            </div>
        `;
        tbody.appendChild(row);
    });
}

window.addToCart = (code) => {
    const qty = parseInt(document.getElementById(`qty-${code}`).value);
    if (qty === 0) return alert("請選擇大於 0 的數量");
    const p = dynamicProducts.find(x => x.code === code);
    const idx = cart.findIndex(x => x.code === code);
    if (idx > -1) cart[idx].qty = qty; else cart.push({ ...p, qty });
    document.getElementById(`qty-${code}`).value = 0; 
    updateCartUI();
    alert(`已將 ${qty} 箱 ${p.name} 加入購物車`);
};

window.removeFromCart = (code) => { cart = cart.filter(x => x.code !== code); updateCartUI(); };

function updateCartUI() {
    localStorage.setItem('drink_cart', JSON.stringify(cart));
    document.getElementById('cartCount').innerText = cart.length;
    const tbody = document.getElementById('cartList');
    tbody.innerHTML = '';
    let total = 0;

    cart.forEach(item => {
        const sub = item.price * item.qty;
        total += sub;
        tbody.innerHTML += `
            <div class="flex flex-col md:flex-row md:items-center p-4 gap-2 border-b">
                <div class="flex-1 flex gap-3"><span class="w-16 text-sm text-gray-500">${item.code}</span><span class="font-medium">${item.name}</span></div>
                <div class="flex items-center gap-4 justify-end">
                    <span class="w-20 text-right text-gray-600">$${item.price}</span>
                    <span class="w-16 text-center text-gray-800">x ${item.qty}</span>
                    <span class="w-24 text-right text-green-700 font-bold">$${sub}</span>
                    <button onclick="removeFromCart('${item.code}')" class="text-red-500 hover:text-red-700 text-sm border px-3 py-1 rounded">刪除</button>
                </div>
            </div>`;
    });
    document.getElementById('cartTotal').innerText = total;
}

// 修改與取消修改邏輯
window.editOrder = (orderId) => {
    const o = allOrdersCache.find(x => x.id === orderId);
    if(!o) return;
    if(isOrderLocked(o.createdAt?.toMillis())) return alert("此訂單已過截單時間，無法修改！");
    if(!confirm("將訂單載入購物車進行修改？修改確認前原訂單仍會保留。")) return;
    
    cart = [...o.items];
    editingOrderId = o.id;
    updateCartUI();
    document.getElementById('checkoutBtn').innerText = "儲存修改";
    document.getElementById('cancelEditBtn').style.display = "inline-block";
    document.getElementById('cartTitle').innerText = "編輯訂單中...";
    window.showSection('cart');
};

window.cancelEdit = () => {
    editingOrderId = null;
    cart = [];
    updateCartUI();
    document.getElementById('checkoutBtn').innerText = "確認訂購";
    document.getElementById('cancelEditBtn').style.display = "none";
    document.getElementById('cartTitle').innerText = "你的購物車";
    window.showSection('history');
};

document.getElementById('checkoutBtn').addEventListener('click', async () => {
    if (cart.length === 0) return alert("購物車是空的！");
    const orderName = document.getElementById('userName').value.trim();
    if (!orderName) return alert("請輸入訂購人姓名！");

    const btn = document.getElementById('checkoutBtn');
    btn.disabled = true; btn.innerText = "處理中...";

    try {
        const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
        const orderData = {
            uid: currentUser.uid,
            email: currentUser.email,
            orderName,
            items: cart.map(item => ({ code: item.code, name: item.name, price: item.price, qty: item.qty, subtotal: item.price * item.qty })),
            total,
            isPaid: false
        };

        const action = editingOrderId ? 'update' : 'new';
        
        if (editingOrderId) {
            await updateDoc(doc(db, "orders", editingOrderId), orderData);
        } else {
            orderData.createdAt = serverTimestamp();
            await addDoc(collection(db, "orders"), orderData);
        }
        
        fetch('/api/send-confirmation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, email: currentUser.email, orderName, items: orderData.items, total })
        });

        cancelEdit(); // 復原按鈕與清空購物車
        await loadUserPurchaseHistory(); 
        renderProducts(dynamicProducts); 
        alert(editingOrderId ? "訂單已成功修改！" : "訂購成功！");
        window.showSection('history');
    } catch (error) { alert("處理失敗: " + error.message); } 
    finally { btn.disabled = false; }
});

// 切換付款狀態 (無 Email)
window.togglePaid = async (orderId, currentStatus) => {
    try {
        await updateDoc(doc(db, "orders", orderId), { isPaid: !currentStatus });
        if(document.getElementById('adminSection').style.display === 'block') loadAllOrdersForAdmin();
        else loadOrderHistory();
    } catch(e) { alert("更新付款狀態失敗: " + e.message); }
};

window.deleteOrderAPI = async (orderId, email, orderName, total) => {
    const o = allOrdersCache.find(x => x.id === orderId);
    if(isOrderLocked(o?.createdAt?.toMillis())) return alert("此訂單已過截單時間，無法刪除！");
    if(!confirm("確定要刪除這筆訂單嗎？此動作無法復原。")) return;

    try {
        await deleteDoc(doc(db, "orders", orderId));
        fetch('/api/send-confirmation', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', email, orderName, items: [], total })
        });
        alert("訂單已刪除！");
        if(document.getElementById('adminSection').style.display === 'block') loadAllOrdersForAdmin();
        else loadOrderHistory();
    } catch(e) { alert("刪除失敗: " + e.message); }
};

// 產生訂單卡片 HTML (共用)
function generateOrderHTML(order, isAdmin) {
    const millis = order.createdAt?.toMillis();
    const dateStr = millis ? new Date(millis).toLocaleString('zh-HK') : '剛剛';
    const locked = isOrderLocked(millis);
    const itemsHtml = order.items.map(i => `<li>${i.name} <span class="text-sm text-gray-500">(x${i.qty})</span> - <span class="font-medium">$${i.subtotal}</span></li>`).join('');
    
    let btnHtml = `<button onclick="togglePaid('${order.id}', ${order.isPaid || false})" class="px-4 py-1.5 rounded text-sm font-medium ${order.isPaid ? 'bg-gray-200 text-gray-700' : 'bg-green-100 text-green-700 border border-green-300 hover:bg-green-200'}">${order.isPaid ? '✅ 已付款' : '待付款'}</button>`;
    
    if (!locked || isAdmin) {
        btnHtml += `<button onclick="editOrder('${order.id}')" class="ml-2 bg-blue-50 text-blue-600 border border-blue-200 px-3 py-1.5 rounded text-sm hover:bg-blue-100">修改</button>
                    <button onclick="deleteOrderAPI('${order.id}', '${order.email}', '${order.orderName}', ${order.total})" class="ml-2 bg-red-500 text-white px-3 py-1.5 rounded text-sm hover:bg-red-600">刪除</button>`;
    } else {
        btnHtml += `<span class="ml-3 text-xs text-red-500 font-bold bg-red-50 px-2 py-1 rounded">已鎖定截單</span>`;
    }

    return `
        <div class="border ${order.isPaid ? 'border-green-300' : 'border-gray-200'} p-5 rounded-lg bg-white shadow-sm space-y-2 relative">
            ${isAdmin ? `<p class="text-gray-800"><strong>${order.orderName}</strong> <span class="text-xs text-gray-500">(${order.email})</span></p>` : `<p class="text-gray-800"><strong>訂購人：</strong> ${order.orderName}</p>`}
            <p class="text-sm text-gray-500"><strong>時間：</strong> ${dateStr}</p>
            <ul class="list-disc list-inside text-gray-700 ml-2 pt-2">${itemsHtml}</ul>
            <div class="flex justify-between items-center pt-3 border-t mt-3">
                <div>${btnHtml}</div>
                <div class="text-lg font-bold text-green-600">總計：$${order.total}</div>
            </div>
        </div>`;
}

async function loadOrderHistory() {
    const list = document.getElementById('orderHistoryList');
    list.innerHTML = '載入中...';
    try {
        const snap = await getDocs(query(collection(db, "orders"), where("uid", "==", currentUser.uid)));
        allOrdersCache = [];
        snap.forEach(doc => allOrdersCache.push({ id: doc.id, ...doc.data() }));
        allOrdersCache.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
        list.innerHTML = allOrdersCache.length ? allOrdersCache.map(o => generateOrderHTML(o, false)).join('') : '尚無記錄';
    } catch (e) { list.innerHTML = "錯誤: " + e.message; }
}

// ==========================================
// 管理員功能
// ==========================================
window.switchAdminTab = (tab) => {
    ['orders', 'supplier', 'products'].forEach(t => {
        document.getElementById(`admin${t.charAt(0).toUpperCase() + t.slice(1)}Tab`).style.display = t === tab ? 'block' : 'none';
        document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`).className = t === tab ? "bg-green-600 text-white px-4 py-2 rounded-lg font-medium" : "bg-gray-100 text-gray-700 hover:bg-gray-200 px-4 py-2 rounded-lg font-medium";
    });
    if(tab === 'supplier') renderSupplierList();
};

async function loadAllOrdersForAdmin() {
    try {
        const snap = await getDocs(collection(db, "orders"));
        allOrdersCache = [];
        let months = new Set();
        
        snap.forEach(doc => {
            const data = doc.data();
            allOrdersCache.push({ id: doc.id, ...data });
            if(data.createdAt) months.add(getOrderCycleMonth(data.createdAt.toMillis()));
        });
        
        allOrdersCache.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
        
        // 建立月份選單
        const mFilter1 = document.getElementById('adminMonthFilter');
        const mFilter2 = document.getElementById('supplierMonthFilter');
        const sortedMonths = Array.from(months).sort().reverse();
        
        const optionsHtml = sortedMonths.map(m => `<option value="${m}">${m} 週期</option>`).join('');
        mFilter1.innerHTML = optionsHtml;
        mFilter2.innerHTML = optionsHtml;
        
        window.renderAdminOrders();
    } catch(e) { document.getElementById('allOrdersList').innerHTML = "錯誤: " + e.message; }
}

window.renderAdminOrders = () => {
    const sel = document.getElementById('adminMonthFilter').value;
    const filtered = allOrdersCache.filter(o => o.createdAt && getOrderCycleMonth(o.createdAt.toMillis()) === sel);
    document.getElementById('allOrdersList').innerHTML = filtered.length ? filtered.map(o => generateOrderHTML(o, true)).join('') : '此月無訂單';
};

window.renderSupplierList = () => {
    const sel = document.getElementById('supplierMonthFilter').value;
    const filtered = allOrdersCache.filter(o => o.createdAt && getOrderCycleMonth(o.createdAt.toMillis()) === sel);
    
    let grouped = {};
    let grandTotal = 0;
    
    filtered.forEach(o => {
        o.items.forEach(i => {
            if(!grouped[i.code]) grouped[i.code] = { code: i.code, name: i.name, price: i.price, qty: 0, sub: 0 };
            grouped[i.code].qty += i.qty;
            grouped[i.code].sub += i.subtotal;
            grandTotal += i.subtotal;
        });
    });

    const arr = Object.values(grouped).sort((a,b) => a.code.localeCompare(b.code, undefined, {numeric: true}));
    
    document.getElementById('supplierListContainer').innerHTML = arr.map(i => `
        <div class="flex flex-col md:flex-row p-4 border-b hover:bg-gray-50">
            <div class="w-16 text-sm text-gray-500">${i.code}</div>
            <div class="flex-1 font-medium">${i.name}</div>
            <div class="w-20 text-right text-gray-600">$${i.price}</div>
            <div class="w-20 text-center font-bold text-gray-800">x ${i.qty}</div>
            <div class="w-24 text-right text-green-700 font-bold">$${i.sub}</div>
        </div>
    `).join('');
    document.getElementById('supplierGrandTotal').innerText = grandTotal;
};

// 3. 產品管理 (新增、匯入、刪除)
window.importProductsToDB = async () => {
    if(!confirm("確定要將原本 products.js 的資料匯入到資料庫嗎？\n(如果已經匯入過，請不要重複執行以免覆蓋現有資料)")) return;
    
    const importBtn = event.target;
    importBtn.innerText = "匯入中...";
    importBtn.disabled = true;

    try {
        // 利用 setDoc 並以產品 code 作為文件 ID，確保不會重複
        for (const p of oldProducts) {
            await setDoc(doc(db, "products", p.code), p);
        }
        alert("全部產品匯入成功！以後都可以直接在網頁管理產品了！");
        await loadProductsFromDB();
        renderAdminProducts();
        renderProducts(dynamicProducts);
    } catch (error) {
        alert("匯入失敗: " + error.message);
    } finally {
        importBtn.innerText = "一鍵匯入舊資料";
        importBtn.disabled = false;
    }
};

window.addNewProduct = async () => {
    const code = document.getElementById('newProdCode').value.trim();
    const name = document.getElementById('newProdName').value.trim();
    const packing = document.getElementById('newProdPacking').value.trim();
    const price = parseFloat(document.getElementById('newProdPrice').value);

    if(!code || !name || !packing || isNaN(price)) return alert("請填寫完整產品資料，且價錢必須為數字！");

    try {
        // 使用 code 當作 ID，如果已經存在就會自動覆寫(修改)
        await setDoc(doc(db, "products", code), { code, name, packing, price });
        alert("產品儲存成功！");
        
        // 清空輸入框
        document.getElementById('newProdCode').value = '';
        document.getElementById('newProdName').value = '';
        document.getElementById('newProdPacking').value = '';
        document.getElementById('newProdPrice').value = '';
        
        await loadProductsFromDB();
        renderAdminProducts();
        renderProducts(dynamicProducts);
    } catch (error) {
        alert("儲存失敗: " + error.message);
    }
};

window.deleteProduct = async (code, name) => {
    if(!confirm(`確定要從資料庫中永久刪除【${name}】嗎？`)) return;
    try {
        await deleteDoc(doc(db, "products", code));
        alert("產品已刪除！");
        await loadProductsFromDB();
        renderAdminProducts();
        renderProducts(dynamicProducts);
    } catch (error) {
        alert("刪除失敗: " + error.message);
    }
};

function renderAdminProducts() {
    const listDiv = document.getElementById('adminProductList');
    
    // 依據 code 排一下順序
    const sorted = [...dynamicProducts].sort((a, b) => a.code.localeCompare(b.code, undefined, {numeric: true}));
    
    listDiv.innerHTML = sorted.map(p => `
        <div class="flex flex-col md:flex-row justify-between md:items-center p-4 hover:bg-gray-50">
            <div class="flex items-start md:items-center gap-4">
                <span class="text-sm text-gray-500 font-mono w-12">${p.code}</span>
                <span class="font-medium text-gray-800">${p.name} <span class="text-sm text-gray-500 font-normal ml-2">(${p.packing})</span></span>
            </div>
            <div class="flex items-center gap-4 mt-2 md:mt-0 justify-end w-full md:w-auto border-t md:border-0 pt-2 md:pt-0">
                <span class="text-green-600 font-bold">$${p.price}</span>
                <button onclick="deleteProduct('${p.code}', '${p.name}')" class="text-red-500 hover:text-red-700 text-sm border border-red-200 px-3 py-1 rounded transition bg-white">刪除</button>
            </div>
        </div>
    `).join('');
}
