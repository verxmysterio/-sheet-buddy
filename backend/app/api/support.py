from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from ..models.database import get_db
from ..models.models import User, SupportQuery
from ..schemas.schemas import SupportQueryCreate, SupportQueryResponse
from .deps import get_current_user

router = APIRouter(prefix="/support", tags=["Support Desk"])

@router.post("/query", response_model=SupportQueryResponse)
def create_support_query(
    query_in: SupportQueryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = SupportQuery(
        user_id=current_user.id,
        subject=query_in.subject,
        description=query_in.description,
        whatsapp_number=query_in.whatsapp_number
    )
    db.add(query)
    db.commit()
    db.refresh(query)
    return query
