const nodemailer = require('nodemailer');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { action, email, orderName, items, total } = req.body;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD }
        });

        let subject, introText, itemsText = "";
        
        if (action === 'delete') {
            subject = `【藍色奶訂購】訂單已取消`;
            introText = `Hi ${orderName}，\n\n您的飲品訂單已成功取消。`;
        } else {
            subject = action === 'update' ? `【藍色奶訂購】訂單已更新` : `【藍色奶訂購】您的訂單已成功提交`;
            introText = action === 'update' ? `Hi ${orderName}，\n\n您的訂單已成功修改，以下是最新明細：\n\n` : `Hi ${orderName}，\n\n系統已記錄您的訂單，以下是明細：\n\n`;
            itemsText = items.map(i => `・ ${i.name} (編號: ${i.code}) x ${i.qty}箱 - 小計: $${i.subtotal}`).join('\n') + `\n\n----------------------------------\n總金額：$${total}`;
        }

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject,
            text: `${introText}${itemsText}\n\n如有任何問題，請聯絡管理員。`
        });

        return res.status(200).json({ success: true });
    } catch (error) { return res.status(500).json({ error: error.message }); }
}
