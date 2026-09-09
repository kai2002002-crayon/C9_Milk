const admin = require('firebase-admin');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const path = require('path');

// 1. 初始化 Firebase Admin (利用 Vercel 環境變數)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            // 處理私鑰的換行字元
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        })
    });
}
const db = admin.firestore();

export default async function handler(req, res) {
    // 2. 日期判斷邏輯：轉換為香港時間 (UTC+8)
    const now = new Date();
    const hkTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const year = hkTime.getUTCFullYear();
    const month = hkTime.getUTCMonth(); // 0-11
    const date = hkTime.getUTCDate();
    
    // 計算當月最後一天
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    
    // 判斷今天是不是「月尾前兩日」(例如31日的倒數第三天是29日)
    if (date !== lastDay - 2) {
        return res.status(200).send(`今天是 ${date} 號，不是截單日 (${lastDay - 2} 號)。程式略過執行。`);
    }

    try {
        // 3. 從 Firestore 獲取本月訂單
        // 設定本月的起始與結束時間 (香港時間轉換回 UTC 給資料庫查詢用)
        const startOfMonth = new Date(Date.UTC(year, month, 1));
        const endOfMonth = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));

        const snapshot = await db.collection('orders')
            .where('createdAt', '>=', startOfMonth)
            .where('createdAt', '<=', endOfMonth)
            .get();

        if (snapshot.empty) {
            return res.status(200).send('本月沒有任何訂單記錄。');
        }

        let totalGrandSum = 0;
        let allItems = [];

        // 整理訂單資料
        snapshot.forEach(doc => {
            const order = doc.data();
            order.items.forEach(item => {
                allItems.push({
                    colleague: order.orderName,
                    code: item.code,
                    name: item.name,
                    qty: item.qty,
                    subtotal: item.subtotal
                });
                totalGrandSum += item.subtotal;
            });
        });

        // 4. 生成 PDF 檔案
        const doc = new PDFDocument({ margin: 30 });
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));

        return new Promise((resolve, reject) => {
            doc.on('end', async () => {
                const pdfBuffer = Buffer.concat(buffers);

                // 5. 使用 Nodemailer 寄信
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        user: process.env.EMAIL_USER,
                        pass: process.env.EMAIL_APP_PASSWORD // Gmail 應用程式密碼
                    }
                });

                const mailOptions = {
                    from: process.env.EMAIL_USER,
                    to: process.env.EMAIL_RECEIVER, // 你的接收信箱
                    subject: `${year}年${month + 1}月 - 內部飲品訂購總清單`,
                    text: `附件是本月的飲品訂購總清單，總金額為 $${totalGrandSum}。`,
                    attachments: [
                        {
                            filename: `Order_List_${year}_${month + 1}.pdf`,
                            content: pdfBuffer
                        }
                    ]
                };

                await transporter.sendMail(mailOptions);
                res.status(200).send('截單成功！PDF 已生成並發送至 Email。');
                resolve();
            });

            // --- 開始繪製 PDF 內容 ---
            // 載入中文字體 (放在 api 資料夾內)
            const fontPath = path.join(process.cwd(), 'api', 'NotoSansTC-Regular.ttf');
            doc.font(fontPath);

            doc.fontSize(20).text(`${year}年${month + 1}月 飲品訂購總清單`, { align: 'center' });
            doc.moveDown();

            // 畫表格標題
            doc.fontSize(12);
            doc.text('姓名', 30, doc.y, { continued: true, width: 80 });
            doc.text('編號', 110, doc.y, { continued: true, width: 60 });
            doc.text('產品名稱', 170, doc.y, { continued: true, width: 200 });
            doc.text('數量', 370, doc.y, { continued: true, width: 50 });
            doc.text('小計($)', 420, doc.y);
            
            doc.moveTo(30, doc.y).lineTo(500, doc.y).stroke();
            doc.moveDown(0.5);

            // 畫表格內容
            allItems.forEach(item => {
                doc.text(item.colleague, 30, doc.y, { continued: true, width: 80 });
                doc.text(item.code, 110, doc.y, { continued: true, width: 60 });
                doc.text(item.name, 170, doc.y, { continued: true, width: 200 });
                doc.text(item.qty.toString(), 370, doc.y, { continued: true, width: 50 });
                doc.text(item.subtotal.toString(), 420, doc.y);
                doc.moveDown(0.5);
            });

            doc.moveDown();
            doc.moveTo(30, doc.y).lineTo(500, doc.y).stroke();
            doc.moveDown();
            
            // 總金額
            doc.fontSize(16).text(`本月總金額: $${totalGrandSum}`, { align: 'right' });
            
            doc.end();
        });

    } catch (error) {
        console.error(error);
        return res.status(500).send('執行失敗: ' + error.message);
    }
}
