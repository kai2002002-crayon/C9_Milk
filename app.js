import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
// 【修改】這裡多引入了 setDoc
import { getFirestore, collection, addDoc, query, where, getDocs, orderBy, serverTimestamp, deleteDoc, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
// 保留 products.js 僅供第一次一鍵匯入使用
import oldProducts from './products.js'; 

const firebaseConfig = {
  apiKey: "AIzaSyATCX2DDrRgRMtKCeslfSz5nEXEd_mqA7U",
  authDomain: "c9milk-bd868.firebaseapp.com",
  projectId: "c9milk-bd868",
  storageBucket: "c9milk-bd868.firebasestorage.app",
  messagingSenderId: "766220739285",
  appId: "1:766220739285:web:68ba76af551d9f1ae9785c",
  measurementId: "G-WXKW5D8CL2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const ADMIN_EMAILS = ["kai2002002@gmail.com"];

let currentUser = null;
let cart = JSON.parse(localStorage.getItem('drink_cart')) || [];
let userPurchaseHistory = new Set();
let dynamicProducts = []; // 【新增】用來存放從資料庫抓下來的產品

window.showSection = (sectionId) => {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('productsSection').style.display = 'none';
    document.getElementById('cartSection').style.display = 'none';
    document.getElementById('historySection').style.display = 'none';
    document.getElementById('adminSection').style.display = 'none';
    document.getElementById(sectionId + 'Section').style.display = 'block';

    if (sectionId === 'history') loadOrderHistory();
    if (sectionId === 'admin') {
        window.switchAdminTab('orders'); // 預設打開訂單管理
        loadAllOrdersForAdmin();
    }
};

document.getElementById('loginBtn').addEventListener('click', () => {
    signInWithPopup(auth, provider).catch(error => alert("登入失敗: " + error.message));
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    signOut(auth).then(() => { cart = []; updateCartUI(); });
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('navLinks').style.display = 'flex';
        document.getElementById('userName').value = user.displayName; 
        
        const adminBtn = document.getElementById('adminNavBtn');
        if (ADMIN_EMAILS.includes(user.email)) {
            adminBtn.style.display = 'inline-block';
        } else {
            adminBtn.style.display = 'none';
        }

        await loadUserPurchaseHistory(); 
        await loadProductsFromDB(); // 【新增】登入後先從資料庫抓產品
        renderProducts(dynamicProducts); 
        updateCartUI(); 
        
        window.showSection('products');
    } else {
        currentUser = null;
        document.getElementById('navLinks').style.display = 'none';
        document.getElementById('adminNavBtn').style.display = 'none';
        window.showSection('login');
    }
});

// ==========================================
// 產品資料庫與搜尋邏輯
// ==========================================
// 【新增】從 Firestore 下載產品清單
async function loadProductsFromDB() {
    const querySnapshot = await getDocs(collection(db, "products"));
    dynamicProducts = [];
    querySnapshot.forEach((doc) => {
        dynamicProducts.push(doc.data());
    });
}

async function loadUserPurchaseHistory() {
    userPurchaseHistory.clear();
    const q = query(collection(db, "orders"), where("uid", "==", currentUser.uid));
    const querySnapshot = await getDocs(q);
    querySnapshot.forEach((doc) => {
        const order = doc.data();
        order.items.forEach(item => userPurchaseHistory.add(item.code));
    });
}

document.getElementById('searchInput').addEventListener('input', (e) => {
    const keyword = e.target.value.toLowerCase().trim();
    const filtered = dynamicProducts.filter(p => 
        p.name.toLowerCase().includes(keyword) || 
        p.code.toLowerCase().includes(keyword)
    );
    renderProducts(filtered);
});

function renderProducts(productList) {
    const tbody = document.getElementById('productList');
    tbody.innerHTML = '';
    
    if (productList.length === 0) {
        tbody.innerHTML = '<div class="p-6 text-center text-gray-500">找不到產品，或資料庫目前沒有產品。</div>';
        return;
    }

    const sortedProducts = [...productList].sort((a, b) => {
        const aBought = userPurchaseHistory.has(a.code);
        const bBought = userPurchaseHistory.has(b.code);
        if (aBought && !bBought) return -1;
        if (!aBought && bBought) return 1;
        return a.code.localeCompare(b.code, undefined, {numeric: true});
    });

    sortedProducts.forEach(p => {
        const row = document.createElement('div');
        row.className = "flex flex-col md:flex-row md:items-center p-4 gap-2 md:gap-4 hover:bg-gray-50 transition-colors";
        if(userPurchaseHistory.has(p.code)) row.classList.add('bg-green-50');

        row.innerHTML = `
            <div class="flex items-start md:items-center gap-3 flex-1">
                <div class="w-12 md:w-16 text-sm text-gray-500 font-medium pt-1 md:pt-0">${p.code}</div>
                <div class="flex-1 font-medium text-gray-800 leading-snug">${p.name} ${userPurchaseHistory.has(p.code) ? '⭐' : ''}</div>
                <div class="w-auto md:w-24 text-sm text-gray-500 pt-1 md:pt-0">${p.packing}</div>
            </div>
            
            <div class="flex items-center justify-end gap-3 w-full md:w-auto mt-2 md:mt-0">
                <div class="w-auto md:w-20 text-green-700 font-bold text-right">$${p.price}</div>
                <div class="w-auto md:w-20 text-center">
                    <select id="qty-${p.code}" class="border border-gray-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 w-16 text-center">
                        ${[0,1,2,3,4,5,6,7,8,9,10].map(n => `<option value="${n}">${n}</option>`).join('')}
                    </select>
                </div>
                <div class="w-auto md:w-16 text-right">
                    <button onclick="addToCart('${p.code}')" class="bg-green-600 text-white px-4 py-1.5 rounded hover:bg-green-700 text-sm shadow-sm transition duration-150">加入</button>
                </div>
            </div>
        `;
        tbody.appendChild(row);
    });
}

// 購物車與訂單相關邏輯 (保持不變)
window.addToCart = (code) => {
    const qtySelect = document.getElementById(`qty-${code}`);
    const qty = parseInt(qtySelect.value);
    if (qty === 0) return alert("請選擇大於 0 的數量");

    const product = dynamicProducts.find(p => p.code === code);
    const existingItemIndex = cart.findIndex(item => item.code === code);

    if (existingItemIndex > -1) cart[existingItemIndex].qty = qty; 
    else cart.push({ ...product, qty });

    qtySelect.value = 0; 
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
            <div class="flex flex-col md:flex-row md:items-center p-4 gap-2 md:gap-4 hover:bg-gray-50 transition-colors">
                <div class="flex items-start md:items-center gap-3 flex-1">
                    <div class="w-12 md:w-16 text-sm text-gray-500 font-medium">${item.code}</div>
                    <div class="flex-1 font-medium text-gray-800 leading-snug">${item.name}</div>
                </div>
                
                <div class="flex items-center justify-end gap-4 w-full md:w-auto mt-2 md:mt-0">
                    <div class="w-auto md:w-20 text-gray-600 text-right">$${item.price}</div>
                    <div class="w-auto md:w-16 text-gray-800 font-medium text-center">x ${item.qty}</div>
                    <div class="w-auto md:w-24 text-green-700 font-bold text-right">$${subtotal}</div>
                    <div class="w-auto md:w-16 text-right">
                        <button onclick="removeFromCart('${item.code}')" class="text-red-500 hover:text-red-700 font-medium text-sm border border-red-200 px-3 py-1.5 rounded hover:bg-red-50 transition">刪除</button>
                    </div>
                </div>
            </div>
        `;
    });
    document.getElementById('cartTotal').innerText = total;
}

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

        await addDoc(collection(db, "orders"), orderData);
        
        try {
            await fetch('/api/send-confirmation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: currentUser.email,
                    orderName: orderName,
                    items: orderData.items,
                    total: orderData.total
                })
            });
        } catch (emailError) {
            console.error("確認信發送失敗", emailError);
        }

        cart = [];
        updateCartUI();
        await loadUserPurchaseHistory(); 
        renderProducts(dynamicProducts); 
        
        alert("訂購成功！確認信已發送。");
        window.showSection('history');
    } catch (error) {
        alert("訂購失敗: " + error.message);
    } finally {
        checkoutBtn.disabled = false;
        checkoutBtn.innerText = "確認訂購";
    }
});

async function loadOrderHistory() {
    const listDiv = document.getElementById('orderHistoryList');
    listDiv.innerHTML = '<p class="text-gray-500">載入中...</p>';
    try {
        const q = query(collection(db, "orders"), where("uid", "==", currentUser.uid));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            listDiv.innerHTML = '<p class="text-gray-500">尚未有任何訂購記錄。</p>';
            return;
        }
        let orders = [];
        querySnapshot.forEach(doc => orders.push(doc.data()));
        orders.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());

        listDiv.innerHTML = orders.map(order => {
            const dateStr = order.createdAt ? new Date(order.createdAt.toMillis()).toLocaleString('zh-HK') : '剛剛';
            const itemsHtml = order.items.map(item => 
                `<li>${item.name} <span class="text-gray-500 text-sm">(x${item.qty})</span> - <span class="font-medium">$${item.subtotal}</span></li>`
            ).join('');
            return `
                <div class="border border-gray-200 p-5 rounded-lg bg-white shadow-sm space-y-2">
                    <p class="text-sm text-gray-500"><strong>訂購時間：</strong> ${dateStr}</p>
                    <p class="text-gray-800"><strong>訂購人：</strong> ${order.orderName}</p>
                    <ul class="list-disc list-inside text-gray-700 space-y-1 ml-2">${itemsHtml}</ul>
                    <div class="text-right text-lg font-bold text-green-600 pt-2 border-t mt-3">總計：$${order.total}</div>
                </div>
            `;
        }).join('');
    } catch (error) {
        listDiv.innerHTML = '<p class="text-red-500">讀取記錄失敗: ' + error.message + '</p>';
    }
}

// ==========================================
// 管理員功能：管理所有訂單與產品資料庫
// ==========================================
// 1. 管理員分頁切換
window.switchAdminTab = (tab) => {
    const tabOrders = document.getElementById('tabOrders');
    const tabProducts = document.getElementById('tabProducts');
    const adminOrdersTab = document.getElementById('adminOrdersTab');
    const adminProductsTab = document.getElementById('adminProductsTab');

    if (tab === 'orders') {
        adminOrdersTab.style.display = 'block';
        adminProductsTab.style.display = 'none';
        tabOrders.className = "bg-green-600 text-white px-4 py-2 rounded-lg shadow-sm font-medium";
        tabProducts.className = "bg-gray-100 text-gray-700 hover:bg-gray-200 px-4 py-2 rounded-lg font-medium transition";
        loadAllOrdersForAdmin();
    } else {
        adminOrdersTab.style.display = 'none';
        adminProductsTab.style.display = 'block';
        tabOrders.className = "bg-gray-100 text-gray-700 hover:bg-gray-200 px-4 py-2 rounded-lg font-medium transition";
        tabProducts.className = "bg-green-600 text-white px-4 py-2 rounded-lg shadow-sm font-medium";
        renderAdminProducts();
    }
};

// 2. 訂單管理
async function loadAllOrdersForAdmin() {
    const listDiv = document.getElementById('allOrdersList');
    listDiv.innerHTML = '<p class="text-gray-500">載入中...</p>';
    try {
        const querySnapshot = await getDocs(collection(db, "orders"));
        if (querySnapshot.empty) {
            listDiv.innerHTML = '<p class="text-gray-500">目前沒有任何訂單記錄。</p>';
            return;
        }
        let orders = [];
        querySnapshot.forEach(docSnap => { orders.push({ id: docSnap.id, ...docSnap.data() }); });
        orders.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

        listDiv.innerHTML = orders.map(order => {
            const dateStr = order.createdAt ? new Date(order.createdAt.toMillis()).toLocaleString('zh-HK') : '剛剛';
            const itemsHtml = order.items.map(item => 
                `<li>${item.name} <span class="text-gray-400 text-sm">(編號:${item.code})</span> <span class="font-medium text-gray-600">x ${item.qty}</span> - <span class="font-medium">$${item.subtotal}</span></li>`
            ).join('');
            return `
                <div class="border-l-4 border-l-red-500 border-y border-r border-gray-200 p-5 rounded-r-lg bg-white shadow-sm space-y-2">
                    <p class="text-gray-800"><strong>訂購人：</strong> ${order.orderName} <span class="text-gray-500 text-sm">(${order.email})</span></p>
                    <p class="text-sm text-gray-500"><strong>訂購時間：</strong> ${dateStr}</p>
                    <ul class="list-disc list-inside text-gray-700 space-y-1 ml-2">${itemsHtml}</ul>
                    <div class="text-right text-lg font-bold text-green-600 pt-2 border-t mt-3">總計：$${order.total}</div>
                    <div class="text-right mt-3">
                        <button onclick="deleteOrderByAdmin('${order.id}')" class="bg-red-500 hover:bg-red-600 text-white px-4 py-1.5 rounded text-sm shadow-sm transition">刪除此訂單</button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        listDiv.innerHTML = '<p class="text-red-500">載入失敗: ' + error.message + '</p>';
    }
}

window.deleteOrderByAdmin = async (orderId) => {
    if (!confirm("確定要刪除這筆同事的訂單嗎？")) return;
    try {
        await deleteDoc(doc(db, "orders", orderId));
        alert("訂單已刪除！");
        loadAllOrdersForAdmin(); 
    } catch (error) { alert("刪除失敗: " + error.message); }
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
