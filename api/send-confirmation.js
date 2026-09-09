const nodemailer = require('nodemailer');

export default async function handler(req, res) {
    // 限制只能用 POST 請求
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { email, orderName, items, total } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Missing email' });
    }

    try {
        // 使用與自動截單相同的 Gmail 設定
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_APP_PASSWORD
            }
        });

        // 組合信件內容
        const itemsText = items.map(item => 
            `・ ${item.name} (編號: ${item.code}) x ${item.qty}箱  -  小計: $${item.subtotal}`
        ).join('\n');

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email, // 寄給當下登入的同事 Google 信箱
            subject: `【內部飲品訂購】您的訂單已成功提交`,
            text: `Hi ${orderName}，\n\n感謝你的訂購！系統已經成功記錄你的訂單。以下是你的訂單明細：\n\n${itemsText}\n\n----------------------------------\n總金額：$${total}\n\n如有任何問題，請聯絡管理員。`
        };

        await transporter.sendMail(mailOptions);
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('寄送確認信失敗:', error);
        return res.status(500).json({ error: error.message });
    }
}
