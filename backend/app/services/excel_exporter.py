from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from typing import List
import io
from ..parsers.base import StandardTransaction

def export_transactions_to_excel(transactions: List[StandardTransaction]) -> io.BytesIO:
    """
    Exports a list of standardized transactions to a styled Excel worksheet.
    Returns the file content as a BytesIO stream.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "Bank Transactions"
    
    # 1. Enable grid lines
    ws.views.sheetView[0].showGridLines = True
    
    # 2. Header Row
    headers = [
        "Txn Date",
        "Value Date",
        "Description / Narration",
        "Ref / Cheque No.",
        "Debit (Payments)",
        "Credit (Receipts)",
        "Balance"
    ]
    ws.append(headers)
    
    # Styles
    font_header = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    fill_header = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid") # Dark Navy Blue
    align_center = Alignment(horizontal="center", vertical="center")
    align_left = Alignment(horizontal="left", vertical="center")
    align_right = Alignment(horizontal="right", vertical="center")
    
    thin_border = Border(
        left=Side(style='thin', color='D9D9D9'),
        right=Side(style='thin', color='D9D9D9'),
        top=Side(style='thin', color='D9D9D9'),
        bottom=Side(style='thin', color='D9D9D9')
    )
    
    # Apply header formatting
    ws.row_dimensions[1].height = 26
    for col_idx in range(1, 8):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center
        cell.border = thin_border
        
    # 3. Add Data Rows
    for tx in transactions:
        # Format dates as YYYY-MM-DD
        txn_date_str = tx.txn_date.strftime("%Y-%m-%d")
        val_date_str = tx.val_date.strftime("%Y-%m-%d")
        
        row = [
            txn_date_str,
            val_date_str,
            tx.narration,
            tx.ref_no or "",
            tx.debit if tx.debit is not None else "",
            tx.credit if tx.credit is not None else "",
            tx.balance
        ]
        ws.append(row)
        
        row_idx = ws.max_row
        ws.row_dimensions[row_idx].height = 20
        
        # Format columns
        # Txn Date & Value Date
        ws.cell(row=row_idx, column=1).alignment = align_center
        ws.cell(row=row_idx, column=2).alignment = align_center
        
        # Narration & Ref
        ws.cell(row=row_idx, column=3).alignment = align_left
        ws.cell(row=row_idx, column=4).alignment = align_left
        
        # Debit, Credit, Balance (Number format & Right align)
        for col in [5, 6, 7]:
            c = ws.cell(row=row_idx, column=col)
            c.alignment = align_right
            c.number_format = "#,##0.00"
            
        # Apply borders to all data cells
        for col_idx in range(1, 8):
            ws.cell(row=row_idx, column=col_idx).border = thin_border
            
    # 4. Auto-fit column widths
    for col in ws.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            val = str(cell.value or '')
            # Handle lengths of decimals or long narrations reasonably
            if cell.column == 3: # Description column
                max_len = max(max_len, min(len(val), 50))
            else:
                max_len = max(max_len, len(val))
        ws.column_dimensions[col_letter].width = max(max_len + 3, 12)
        
    # Save to buffer
    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)
    return stream
