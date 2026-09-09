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

        let allItems = []; // 給內部看的詳細名單
        let supplierMap = {}; // 給供應商看的合併清單
        let grandTotal = 0;

        snapshot.forEach(doc => {
            const order = doc.data();
            order.items.forEach(item => {
                allItems.push({ colleague: order.orderName, code: item.code, name: item.name, qty: item.qty, subtotal: item.subtotal });
                grandTotal += item.subtotal;

                // 合併同款商品給供應商
                if(!supplierMap[item.code]) {
                    supplierMap[item.code] = { code: item.code, name: item.name, price: item.price, qty: 0, subtotal: 0 };
                }
                supplierMap[item.code].qty += item.qty;
                supplierMap[item.code].subtotal += item.subtotal;
            });
        });

        const supplierItems = Object.values(supplierMap).sort((a, b) => a.code.localeCompare(b.code, undefined, {numeric: true}));
        const fontPath = path.join(process.cwd(), 'api', 'NotoSansTC-Regular.ttf');

        // 生成 PDF 1: 內部名單
        const internalPdfBuffer = await generatePdfBuffer((doc) => {
            doc.font(fontPath).fontSize(20).text(`${year}年${month + 1}月 飲品訂購內部總表`, { align: 'center' }).moveDown();
            doc.fontSize(12).text('姓名', 30, doc.y, { continued: true, width: 80 }).text('編號', 110, doc.y, { continued: true, width: 60 }).text('產品名稱', 170, doc.y, { continued: true, width: 200 }).text('數量', 370, doc.y, { continued: true, width: 50 }).text('小計($)', 420, doc.y);
            doc.moveTo(30, doc.y).lineTo(500, doc.y).stroke().moveDown(0.5);
            allItems.forEach(i => {
                doc.text(i.colleague, 30, doc.y, { continued: true, width: 80 }).text(i.code, 110, doc.y, { continued: true, width: 60 }).text(i.name, 170, doc.y, { continued: true, width: 200 }).text(i.qty.toString(), 370, doc.y, { continued: true, width: 50 }).text(i.subtotal.toString(), 420, doc.y).moveDown(0.5);
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
            subject: `${year}年${month + 1}月 - 飲品訂購雙清單結算`,
            text: `截單已完成！\n\n附檔包含兩份文件：\n1. Internal_Order_List (內部明細，顯示同事名字)\n2. Supplier_Order_List (供應商專用，合併相同商品總量)\n\n總金額：$${grandTotal}`,
            attachments: [
                { filename: `Internal_Order_List_${year}_${month + 1}.pdf`, content: internalPdfBuffer },
                { filename: `Supplier_Order_List_${year}_${month + 1}.pdf`, content: supplierPdfBuffer }
            ]
        });

        return res.status(200).send('截單成功！雙 PDF 已發送。');
    } catch (error) { return res.status(500).send('失敗: ' + error.message); }
}
