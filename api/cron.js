const admin = require('firebase-admin');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const path = require('path');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        })
    });
}
const db = admin.firestore();

// 輔助函數：將繪製 PDF 的過程轉為 Promise
const generatePdfBuffer = (drawCallback) => {
    return new Promise((resolve) => {
        const doc = new PDFDocument({ margin: 30 });
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        drawCallback(doc);
        doc.end();
    });
};

export default async function handler(req, res) {
    const now = new Date();
    const hkTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const year = hkTime.getUTCFullYear();
    const month = hkTime.getUTCMonth(); 
    const date = hkTime.getUTCDate();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    
    // 截單日判斷 (月尾前兩日)
    if (date !== lastDay - 2) {
        return res.status(200).send(`非截單日，略過。`);
    }

    try {
        const startOfMonth = new Date(Date.UTC(year, month, 1));
        const endOfMonth = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));

        const snapshot = await db.collection('orders').where('createdAt', '>=', startOfMonth).where('createdAt', '<=', endOfMonth).get();
        if (snapshot.empty) return res.status(200).send('本月無訂單。');

        let internalMap = {}; // 【修改】改用 Map 來按「姓名」合併訂單
        let supplierMap = {}; 
        let grandTotal = 0;

        snapshot.forEach(doc => {
            const order = doc.data();
            const personName = order.orderName; // 取得訂購人姓名

            if (!internalMap[personName]) {
                internalMap[personName] = {}; // 初始化這個人的訂單清單
            }

            order.items.forEach(item => {
                // 1. 合併給內部看 (按人名 -> 再按產品)
                if (!internalMap[personName][item.code]) {
                    internalMap[personName][item.code] = { code: item.code, name: item.name, qty: 0, subtotal: 0 };
                }
                internalMap[personName][item.code].qty += item.qty;
                internalMap[personName][item.code].subtotal += item.subtotal;
                
                grandTotal += item.subtotal;

                // 2. 合併給供應商看 (純按產品)
                if(!supplierMap[item.code]) {
                    supplierMap[item.code] = { code: item.code, name: item.name, price: item.price, qty: 0, subtotal: 0 };
                }
                supplierMap[item.code].qty += item.qty;
                supplierMap[item.code].subtotal += item.subtotal;
            });
        });

        const supplierItems = Object.values(supplierMap).sort((a, b) => a.code.localeCompare(b.code, undefined, {numeric: true}));
        const fontPath = path.join(process.cwd(), 'api', 'NotoSansTC-Regular.ttf');

        // 生成 PDF 1: 內部名單 (優化排版)
        const internalPdfBuffer = await generatePdfBuffer((doc) => {
            doc.font(fontPath).fontSize(20).text(`${year}年${month + 1}月 飲品訂購內部總表`, { align: 'center' }).moveDown();
            doc.fontSize(12)
               .text('姓名', 30, doc.y, { continued: true, width: 80 })
               .text('編號', 110, doc.y, { continued: true, width: 60 })
               .text('產品名稱', 170, doc.y, { continued: true, width: 200 })
               .text('數量', 370, doc.y, { continued: true, width: 50 })
               .text('小計($)', 420, doc.y);
            doc.moveTo(30, doc.y).lineTo(500, doc.y).stroke().moveDown(0.5);
            
            // 將人名依照筆畫或字母排序
            const sortedNames = Object.keys(internalMap).sort();
            
            sortedNames.forEach(name => {
                const items = Object.values(internalMap[name]).sort((a, b) => a.code.localeCompare(b.code, undefined, {numeric: true}));
                
                let personTotal = 0;
                
                items.forEach((i, index) => {
                    personTotal += i.subtotal;
                    // 排版小巧思：同一個人的訂單，只有第一行會印出名字，後面留白，視覺上非常乾淨
                    const displayName = index === 0 ? name : '';
                    
                    doc.text(displayName, 30, doc.y, { continued: true, width: 80 })
                       .text(i.code, 110, doc.y, { continued: true, width: 60 })
                       .text(i.name, 170, doc.y, { continued: true, width: 200 })
                       .text(i.qty.toString(), 370, doc.y, { continued: true, width: 50 })
                       .text(i.subtotal.toString(), 420, doc.y).moveDown(0.5);
                });
                
                // 每個人結束後，畫一條淺色虛線或灰線分隔，並顯示個人的總金額
                doc.fontSize(10).fillColor('gray')
                   .text(`${name} 個人應付: $${personTotal}`, { align: 'right' }).moveDown(0.3);
                doc.fillColor('black').fontSize(12); // 顏色調回黑色
                doc.moveTo(30, doc.y).lineTo(500, doc.y).dash(2, { space: 2 }).strokeColor('#cccccc').stroke().undash().strokeColor('black').moveDown(0.5);
            });

            doc.moveDown().moveTo(30, doc.y).lineTo(500, doc.y).stroke().moveDown();
            doc.fontSize(16).text(`本月總金額: $${grandTotal}`, { align: 'right' });
        });

        // 生成 PDF 2: 供應商專用
        const supplierPdfBuffer = await generatePdfBuffer((doc) => {
            doc.font(fontPath).fontSize(20).text(`${year}年${month + 1}月 訂單總出貨清單`, { align: 'center' }).moveDown();
            doc.fontSize(12).text('編號', 30, doc.y, { continued: true, width: 60 }).text('產品名稱', 100, doc.y, { continued: true, width: 230 }).text('單價($)', 330, doc.y, { continued: true, width: 60 }).text('總數量', 390, doc.y, { continued: true, width: 50 }).text('總計($)', 440, doc.y);
            doc.moveTo(30, doc.y).lineTo(500, doc.y).stroke().moveDown(0.5);
            supplierItems.forEach(i => {
                doc.text(i.code, 30, doc.y, { continued: true, width: 60 }).text(i.name, 100, doc.y, { continued: true, width: 230 }).text(i.price.toString(), 330, doc.y, { continued: true, width: 60 }).text(i.qty.toString(), 390, doc.y, { continued: true, width: 50 }).text(i.subtotal.toString(), 440, doc.y).moveDown(0.5);
            });
            doc.moveDown().moveTo(30, doc.y).lineTo(500, doc.y).stroke().moveDown();
            doc.fontSize(16).text(`本期應付總額: $${grandTotal}`, { align: 'right' });
        });

        // 寄出雙 PDF 郵件
        const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD } });
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_RECEIVER,
            subject: `${year}年${month + 1}月 - 藍色奶訂購雙清單結算`,
            text: `截單已完成！\n\n附檔包含兩份文件：\n1. Internal_Order_List (內部明細，顯示同事名字)\n2. Supplier_Order_List (供應商專用，合併相同商品總量)\n\n總金額：$${grandTotal}`,
            attachments: [
                { filename: `Internal_Order_List_${year}_${month + 1}.pdf`, content: internalPdfBuffer },
                { filename: `Supplier_Order_List_${year}_${month + 1}.pdf`, content: supplierPdfBuffer }
            ]
        });

        return res.status(200).send('截單成功！雙 PDF 已發送。');
    } catch (error) { return res.status(500).send('失敗: ' + error.message); }
}
