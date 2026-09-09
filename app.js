import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, getDocs, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import products from './products.js';

// ==========================================
// 1. 請把你在 Firebase 拿到的 Config 貼在這裡
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyATCX2DDrRgRMtKCeslfSz5nEXEd_mqA7U",
  authDomain: "c9milk-bd868.firebaseapp.com",
  projectId: "c9milk-bd868",
  storageBucket: "c9milk-bd868.firebasestorage.app",
  messagingSenderId: "766220739285",
  appId: "1:766220739285:web:68ba76af551d9f1ae9785c",
  measurementId: "G-WXKW5D8CL2"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// 系統狀態
let currentUser = null;
let cart = JSON.parse(localStorage.getItem('drink_cart')) || [];
let userPurchaseHistory = new Set(); // 記錄買過的產品 code

// ==========================================
// 2. 畫面切換控制
// ==========================================
window.showSection = (sectionId) => {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('productsSection').style.display = 'none';
    document.getElementById('cartSection').style.display = 'none';
    document.getElementById('historySection').style.display = 'none';
    document.getElementById(sectionId + 'Section').style.display = 'block';

    if (sectionId === 'history') loadOrderHistory();
};

// ==========================================
// 3. 登入與身份驗證
// ==========================================
document.getElementById('loginBtn').addEventListener('click', () => {
    signInWithPopup(auth, provider).catch(error => alert("登入失敗: " + error.message));
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    signOut(auth).then(() => { cart = []; updateCartUI(); });
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('navLinks').style.display = 'block';
        document.getElementById('userName').value = user.displayName; // 預設填入 Google 名字
        
        await loadUserPurchaseHistory(); // 載入購買歷史以決定排序
        renderProducts(products); // 渲染產品清單
        updateCartUI();
        window.showSection('products');
    } else {
        currentUser = null;
        document.getElementById('navLinks').style.display = 'none';
        window.showSection('login');
    }
});

// ==========================================
// 4. 產品與搜尋邏輯
// ==========================================
// 載入購買記錄 (只取曾買過的 code)
async function loadUserPurchaseHistory() {
    userPurchaseHistory.clear();
    const q = query(collection(db, "orders"), where("uid", "==", currentUser.uid));
    const querySnapshot = await getDocs(q);
    querySnapshot.forEach((doc) => {
        const order = doc.data();
        order.items.forEach(item => userPurchaseHistory.add(item.code));
    });
}

// 搜尋功能
document.getElementById('searchInput').addEventListener('input', (e) => {
    const keyword = e.target.value.toLowerCase().trim();
    // 只要產品名字包含關鍵字，或是 code 包含關鍵字就算符合
    const filtered = products.filter(p => 
        p.name.toLowerCase().includes(keyword) || 
        p.code.toLowerCase().includes(keyword)
    );
    renderProducts(filtered);
});

function renderProducts(productList) {
    const tbody = document.getElementById('productList');
    tbody.innerHTML = '';

    // 排序邏輯：買過的優先，然後按 code 排
    const sortedProducts = [...productList].sort((a, b) => {
        const aBought = userPurchaseHistory.has(a.code);
        const bBought = userPurchaseHistory.has(b.code);
        if (aBought && !bBought) return -1;
        if (!aBought && bBought) return 1;
        // 如果都買過或都沒買過，照 code 排序 (數字順序)
        return a.code.localeCompare(b.code, undefined, {numeric: true});
    });

    sortedProducts.forEach(p => {
        const tr = document.createElement('tr');
        if(userPurchaseHistory.has(p.code)) tr.style.backgroundColor = '#f0fff0'; // 買過的用微綠色底標記

        tr.innerHTML = `
            <td>${p.code}</td>
            <td>${p.name} ${userPurchaseHistory.has(p.code) ? '⭐' : ''}</td>
            <td>${p.packing}</td>
            <td>$${p.price}</td>
            <td>
                <select id="qty-${p.code}">
                    ${[0,1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}">${n}</option>`).join('')}
                </select>
            </td>
            <td><button onclick="addToCart('${p.code}')" class="primary-btn" style="padding: 5px 10px;">加入</button></td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// 5. 購物車邏輯
// ==========================================
window.addToCart = (code) => {
    const qtySelect = document.getElementById(`qty-${code}`);
    const qty = parseInt(qtySelect.value);
    
    if (qty === 0) {
        alert("請選擇大於 0 的數量");
        return;
    }

    const product = products.find(p => p.code === code);
    const existingItemIndex = cart.findIndex(item => item.code === code);

    if (existingItemIndex > -1) {
        cart[existingItemIndex].qty = qty; // 覆蓋數量
    } else {
        cart.push({ ...product, qty });
    }

    qtySelect.value = 0; // 重置下拉選單
    updateCartUI();
    alert(`已將 ${qty} 箱 ${product.name} 加入購物車`);
};

window.removeFromCart = (code) => {
    cart = cart.filter(item => item.code !== code);
    updateCartUI();
};

function updateCartUI() {
    localStorage.setItem('drink_cart', JSON.stringify(cart));
    document.getElementById('cartCount').innerText = cart.length;
    const tbody = document.getElementById('cartList');
    tbody.innerHTML = '';
    let total = 0;

    cart.forEach(item => {
        const subtotal = item.price * item.qty;
        total += subtotal;
        tbody.innerHTML += `
            <tr>
                <td>${item.code}</td>
                <td>${item.name}</td>
                <td>$${item.price}</td>
                <td>${item.qty}</td>
                <td>$${subtotal}</td>
                <td><button onclick="removeFromCart('${item.code}')">刪除</button></td>
            </tr>
        `;
    });
    document.getElementById('cartTotal').innerText = total;
}

// ==========================================
// 6. 結帳與存入資料庫
// ==========================================
document.getElementById('checkoutBtn').addEventListener('click', async () => {
    if (cart.length === 0) return alert("購物車是空的！");
    
    const orderName = document.getElementById('userName').value.trim();
    if (!orderName) return alert("請輸入訂購人姓名！");

    const checkoutBtn = document.getElementById('checkoutBtn');
    checkoutBtn.disabled = true;
    checkoutBtn.innerText = "處理中...";

    try {
        const orderData = {
            uid: currentUser.uid,
            email: currentUser.email,
            orderName: orderName,
            items: cart.map(item => ({
                code: item.code,
                name: item.name,
                price: item.price,
                qty: item.qty,
                subtotal: item.price * item.qty
            })),
            total: cart.reduce((sum, item) => sum + (item.price * item.qty), 0),
            createdAt: serverTimestamp(),
            status: "confirmed"
        };

        // 寫入 Firestore 的 orders 集合
        await addDoc(collection(db, "orders"), orderData);
        
        // 成功後清理購物車
        cart = [];
        updateCartUI();
        await loadUserPurchaseHistory(); // 更新購買歷史，確保回到首頁時⭐標記會出現
        renderProducts(products); 
        
        alert("訂購成功！");
        window.showSection('history');
    } catch (error) {
        alert("訂購失敗: " + error.message);
    } finally {
        checkoutBtn.disabled = false;
        checkoutBtn.innerText = "確認訂購";
    }
});

// ==========================================
// 7. 讀取歷史訂單
// ==========================================
async function loadOrderHistory() {
    const listDiv = document.getElementById('orderHistoryList');
    listDiv.innerHTML = '載入中...';

    try {
        // 抓取該用戶的訂單，按時間排序 (注意: 需要在 Firestore 後台建立索引才能用 orderBy)
        const q = query(collection(db, "orders"), where("uid", "==", currentUser.uid));
        const querySnapshot = await getDocs(q);
        
        if (querySnapshot.empty) {
            listDiv.innerHTML = '<p>尚未有任何訂購記錄。</p>';
            return;
        }

        // 手動排序 (降序)，避免一開始沒建 Firestore 索引而報錯
        let orders = [];
        querySnapshot.forEach(doc => orders.push(doc.data()));
        orders.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());

        listDiv.innerHTML = orders.map(order => {
            const dateStr = order.createdAt ? new Date(order.createdAt.toMillis()).toLocaleString('zh-HK') : '剛剛';
            const itemsHtml = order.items.map(item => 
                `<li>${item.name} (x${item.qty}) - $${item.subtotal}</li>`
            ).join('');

            return `
                <div class="order-card">
                    <p><strong>訂購時間：</strong> ${dateStr}</p>
                    <p><strong>訂購人：</strong> ${order.orderName}</p>
                    <ul>${itemsHtml}</ul>
                    <p style="text-align: right; font-weight: bold; color: var(--primary-color);">總計：$${order.total}</p>
                </div>
            `;
        }).join('');
    } catch (error) {
        listDiv.innerHTML = '讀取記錄失敗: ' + error.message;
    }
}
