import hashlib
import os
import jwt
from datetime import datetime, timedelta
from typing import Optional, Union
from .config import settings

# 1. PBKDF2 Password Hashing (Standard, secure, and dependency-free fallback)
def hash_password(password: str) -> str:
    """
    Hashes a password using PBKDF2 with SHA-256.
    Format returned: pbkdf2_sha256$iterations$salt$hash
    """
    iterations = 100000
    salt = os.urandom(16).hex()
    pwd_bytes = password.encode('utf-8')
    salt_bytes = salt.encode('utf-8')
    
    dk = hashlib.pbkdf2_hmac('sha256', pwd_bytes, salt_bytes, iterations)
    
    return f"pbkdf2_sha256${iterations}${salt}${dk.hex()}"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verifies a plain password against its PBKDF2 hash.
    """
    try:
        if not hashed_password.startswith("pbkdf2_sha256$"):
            return False
        
        parts = hashed_password.split('$')
        if len(parts) != 4:
            return False
            
        _, iterations_str, salt, original_hash = parts
        iterations = int(iterations_str)
        
        pwd_bytes = plain_password.encode('utf-8')
        salt_bytes = salt.encode('utf-8')
        
        dk = hashlib.pbkdf2_hmac('sha256', pwd_bytes, salt_bytes, iterations)
        
        return dk.hex() == original_hash
    except Exception:
        return False

# 2. JWT Tokens
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Generates a secure JWT access token.
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> Optional[dict]:
    """
    Decodes a JWT access token. Returns payload dict or None if invalid/expired.
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None
