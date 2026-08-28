import json
import random
import smtplib
import urllib.request
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from .config import settings

def generate_otp() -> str:
    """Generate a random 6-digit OTP code."""
    return f"{random.randint(100000, 999999)}"

def send_otp_email(to_email: str, otp_code: str, purpose: str) -> bool:
    """Send an OTP email via Resend API, standard SMTP, or fallback to mock printing."""
    if purpose == "VERIFICATION":
        subject = "Balance Sheet Buddy - Verify Your Account"
        body = f"""
<h2>Welcome to Balance Sheet Buddy!</h2>
<p>Please verify your account using the 6-digit OTP code below:</p>
<div style="font-size: 24px; font-weight: bold; background: #ffd615; color: black; padding: 10px; display: inline-block; border: 3px solid black; margin: 10px 0;">
    {otp_code}
</div>
<p>This code will expire in 15 minutes.</p>
"""
    else:
        subject = "Balance Sheet Buddy - Password Reset Code"
        body = f"""
<h2>Reset Your Password</h2>
<p>We received a request to reset your password. Use the 6-digit OTP code below to proceed:</p>
<div style="font-size: 24px; font-weight: bold; background: #ffd615; color: black; padding: 10px; display: inline-block; border: 3px solid black; margin: 10px 0;">
    {otp_code}
</div>
<p>If you did not request a password reset, please ignore this email.</p>
<p>This code will expire in 15 minutes.</p>
"""

    # Option A: Send via Resend HTTP API (Port 443, never blocked by Render Free Tier)
    if settings.RESEND_API_KEY:
        try:
            # Set from address to onboarding@resend.dev unless user has verified custom domain
            from_email = settings.SMTP_FROM
            if not from_email or "@gmail.com" in from_email.lower() or "@yahoo.com" in from_email.lower():
                from_email = "onboarding@resend.dev"
                
            url = "https://api.resend.com/emails"
            headers = {
                "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                "Content-Type": "application/json"
            }
            payload = {
                "from": from_email,
                "to": [to_email],
                "subject": subject,
                "html": body
            }
            
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                res_body = response.read().decode("utf-8")
                print(f"Resend API send success: {res_body}")
                return True
        except Exception as e:
            error_msg = f"Resend API Failure: {str(e)}"
            print(f"Resend Error: Failed to send OTP to {to_email}: {str(e)}")
            raise RuntimeError(error_msg)

    # Option B: Send via standard SMTP
    is_smtp_configured = bool(settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD)
    
    if not is_smtp_configured:
        # Falls back to printing OTP in console block (Mock Mode)
        print("\n" + "="*60)
        print("MOCK SMTP DISPATCH FALLBACK (No Credentials Configured)")
        print(f"To Email: {to_email}")
        print(f"Subject:  {subject}")
        print(" "*10 + "┌" + "─"*22 + "┐")
        print(" "*10 + f"│   OTP CODE: {otp_code}   │")
        print(" "*10 + "└" + "─"*22 + "┘")
        print("="*60 + "\n")
        return True

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
        msg["To"] = to_email
        
        html_part = MIMEText(body, "html")
        msg.attach(html_part)
        
        # Determine connection security by port
        if settings.SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT)
        else:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT)
            server.starttls()
            
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_USER, to_email, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        error_msg = f"SMTP Failure: {str(e)}"
        print(f"SMTP Error: Failed to send OTP to {to_email}: {str(e)}")
        # Print fallback to console in case of delivery failure
        print("\n" + "="*60)
        print("FALLBACK: SMTP Failed - Printing OTP directly:")
        print(f"Email: {to_email} | Purpose: {purpose} | OTP: {otp_code}")
        print("="*60 + "\n")
        raise RuntimeError(error_msg)
