import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendResetEmail(to: string, code: string): Promise<void> {
  const from = process.env.SMTP_FROM || "noreply@example.com";

  // In dev mode without SMTP credentials, just log the code
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`[DEV] Password reset code for ${to}: ${code}`);
    return;
  }

  await transporter.sendMail({
    from,
    to,
    subject: "AI-World 密码重置验证码",
    text: `您的密码重置验证码是：${code}\n\n该验证码将在 15 分钟后过期。如非本人操作，请忽略此邮件。`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1a2e; margin-bottom: 16px;">AI-World 密码重置</h2>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">您正在重置密码，验证码为：</p>
        <div style="background: #f0f4ff; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
          <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #3b5bdb;">${code}</span>
        </div>
        <p style="color: #888; font-size: 12px; line-height: 1.6;">
          该验证码将在 15 分钟后过期。<br/>如非本人操作，请忽略此邮件。
        </p>
      </div>
    `,
  });
}
