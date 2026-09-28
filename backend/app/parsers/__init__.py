import json
import logging
from typing import Optional, Any
from .base import (
    BankParser, 
    StandardTransaction, 
    ParsedTransaction, 
    StatementMetadata, 
    reconcile_statement, 
    reconcile_statement_and_transactions,
    extract_references_from_narration,
    categorize_and_suggest_ledger,
    detect_duplicate_transactions
)
from .sbi import SBIParser
from .hdfc import HDFCParser
from .icici import ICICIParser
from .axis import AxisParser
from .bob import BOBParser
from .pnb import PNBParser
from .kotak import KotakParser
from .rule_based import RuleBasedParser
from .simulator import GenericSimulatorParser

logger = logging.getLogger("sheetbuddy.parsers")

def get_parser(bank_name: str, db_session: Optional[Any] = None) -> BankParser:
    """
    Returns the appropriate bank parser based on bank name, aliases, or BankConfig database records.
    """
    bank_clean = bank_name.strip().upper() if bank_name else ""
    
    # 1. Direct Native Checks
    if any(k in bank_clean for k in ["SBI", "STATE BANK"]):
        return SBIParser()
    elif any(k in bank_clean for k in ["HDFC"]):
        return HDFCParser()
    elif any(k in bank_clean for k in ["ICICI"]):
        return ICICIParser()
    elif any(k in bank_clean for k in ["AXIS", "UTIB"]):
        return AxisParser()
    elif any(k in bank_clean for k in ["BOB", "BARODA", "BARB"]):
        return BOBParser()
    elif any(k in bank_clean for k in ["PNB", "PUNJAB NATIONAL"]):
        return PNBParser()
    elif any(k in bank_clean for k in ["KOTAK"]):
        return KotakParser()
    elif "RULE" in bank_clean:
        return RuleBasedParser(bank_name, {})
    elif "SIMULAT" in bank_clean or "MOCK" in bank_clean or "DEMO" in bank_clean:
        return GenericSimulatorParser(bank_name)
        
    # 2. Check Database Configs if Session Available
    if db_session:
        try:
            from ..models.models import BankConfig
            configs = db_session.query(BankConfig).all()
            for config in configs:
                patterns = [p.strip().upper() for p in config.match_patterns.split(",") if p.strip()]
                for p in patterns:
                    if p in bank_clean:
                        if config.parser_type == "NATIVE":
                            if config.bank_key == "bob":
                                return BOBParser()
                            elif config.bank_key == "axis":
                                return AxisParser()
                            elif config.bank_key == "hdfc":
                                return HDFCParser()
                            elif config.bank_key == "icici":
                                return ICICIParser()
                            elif config.bank_key == "pnb":
                                return PNBParser()
                            elif config.bank_key == "kotak":
                                return KotakParser()
                            else:
                                return SBIParser()
                        elif config.parser_type == "SIMULATOR":
                            cfg = {}
                            try:
                                cfg = json.loads(config.config_json)
                            except Exception:
                                pass
                            op_bal = float(cfg.get("opening_balance", 10000.0))
                            prefix = cfg.get("mock_prefix", "SIMULATED TXN")
                            return GenericSimulatorParser(config.name, op_bal, prefix)
                        elif config.parser_type == "RULE_BASED":
                            cfg = {}
                            try:
                                cfg = json.loads(config.config_json)
                            except Exception:
                                pass
                            return RuleBasedParser(config.name, cfg)
        except Exception as e:
            logger.warning(f"Error resolving bank parser from database configs: {e}")
            
    # Fallback to Generic RuleBased or SBI if unknown
    logger.info(f"Unmatched bank '{bank_name}'. Defaulting to Generic Rule-Based Parser.")
    return RuleBasedParser(bank_name, {})
