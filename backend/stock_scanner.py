"""
Warehouse Stock Scanner & Restock Reporting Engine
==================================================
Quiet automation for daily warehouse operations:
- Scans stock data from CSV (file or raw text)
- Flexible column header matching & edge-case recovery
- Flags low-stock items & assigns Priority Levels (Critical vs Low)
- Calculates suggested reorder quantities based on target stock levels
- Generates clean text reports, downloadable CSV restock summaries, and simulated email alerts
- Features architectural reflection notes for future supply chain scaling
"""

import csv
import io
import json
import os
import sys
import argparse
from datetime import datetime
from typing import List, Dict, Any, Tuple, Optional

# Ensure sys.stdout handles UTF-8 on Windows terminals
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass


# Reflection note on future scalability
REFLECTION_NOTE = """
--- WAREHOUSE AUTOMATION REFLECTION NOTE ---
1. Automated Scheduling: Integrate Celery/Cron jobs to execute this scan daily at 06:00 AM before warehouse shifts begin.
2. Supplier Integration: Connect via REST/EDI APIs to automatically issue purchase orders for 'Critical' restock items.
3. Dynamic Thresholds: Calculate reorder thresholds using historical consumption rate (30-day moving average) + lead time safety stock.
4. Multi-Warehouse Support: Extend item schemas to include warehouse location codes (e.g. Aisle/Bin IDs & Facility Regions).
--------------------------------------------
"""


class StockScanner:
    """Core warehouse stock scanning engine."""

    # Column header alias mappings for flexible CSV parsing
    ITEM_HEADER_ALIASES = ['item_name', 'item', 'product', 'product_name', 'name', 'sku', 'description']
    QTY_HEADER_ALIASES = ['current_quantity', 'quantity', 'qty', 'current_qty', 'stock', 'current_stock', 'in_stock']
    THRESHOLD_HEADER_ALIASES = ['reorder_threshold', 'threshold', 'reorder_level', 'min_qty', 'reorder_qty_min', 'min_stock']
    TARGET_HEADER_ALIASES = ['target_stock', 'target', 'target_qty', 'healthy_stock', 'max_stock', 'ideal_stock']

    def __init__(self, critical_ratio: float = 0.25):
        """
        Initialize scanner with threshold ratio for 'Critical' vs 'Low' priority.
        Default: items with stock <= 25% of reorder threshold (or 0 stock) are marked Critical.
        """
        self.critical_ratio = critical_ratio

    def _normalize_header(self, header: str) -> str:
        """Clean and normalize string header."""
        return header.strip().lower().replace(' ', '_').replace('-', '_')

    def _find_column_key(self, row_keys: List[str], aliases: List[str]) -> Optional[str]:
        """Find the matching key from CSV header row using alias lookup."""
        normalized_keys = {self._normalize_header(k): k for k in row_keys}
        for alias in aliases:
            if alias in normalized_keys:
                return normalized_keys[alias]
        return None

    def parse_number(self, val: Any, default: Optional[float] = None) -> Tuple[Optional[float], Optional[str]]:
        """
        Safe numeric parsing to handle strings like '10 units', 'OUT_OF_STOCK', 'N/A', empty values.
        Returns (parsed_value, warning_message).
        """
        if val is None or str(val).strip() == '':
            return default, "Missing numeric value replaced with fallback"

        val_str = str(val).strip()
        
        # Check common non-numeric strings
        if val_str.upper() in ['OUT_OF_STOCK', 'NONE', 'N/A', 'NULL', 'UNKNOWN', 'MISSING']:
            return 0.0, f"Non-numeric string '{val_str}' interpreted as 0 stock"

        # Extract numeric digits/floats from string (e.g. '15 units' -> 15.0)
        cleaned = ''.join(c for c in val_str if c.isdigit() or c in ['.', '-'])
        if not cleaned or cleaned == '-':
            return default, f"Could not parse numeric value from '{val_str}'"

        try:
            num = float(cleaned)
            # If negative stock, log warning and clamp or handle gracefully
            if num < 0:
                return 0.0, f"Negative stock value '{val_str}' normalized to 0.0"
            return num, None
        except ValueError:
            return default, f"Invalid number format: '{val_str}'"

    def scan_data(self, csv_file_or_content) -> Dict[str, Any]:
        """
        Scans stock data from a file path, file object, or CSV string content.
        Returns a dictionary containing:
        - items: list of all processed stock dictionaries
        - restock_items: list of items needing restock
        - summary_counts: breakdown (total, critical, low, sufficient)
        - warnings: list of parsing warnings/diagnostics
        """
        if isinstance(csv_file_or_content, str):
            if os.path.exists(csv_file_or_content):
                with open(csv_file_or_content, 'r', encoding='utf-8', errors='replace') as f:
                    content = f.read()
            else:
                content = csv_file_or_content
        else:
            content = csv_file_or_content.read()
            if isinstance(content, bytes):
                content = content.decode('utf-8', errors='replace')

        reader = csv.DictReader(io.StringIO(content))
        fieldnames = reader.fieldnames or []

        # Map dynamic headers
        item_col = self._find_column_key(fieldnames, self.ITEM_HEADER_ALIASES)
        qty_col = self._find_column_key(fieldnames, self.QTY_HEADER_ALIASES)
        thresh_col = self._find_column_key(fieldnames, self.THRESHOLD_HEADER_ALIASES)
        target_col = self._find_column_key(fieldnames, self.TARGET_HEADER_ALIASES)

        warnings = []
        if not item_col or not qty_col or not thresh_col:
            warnings.append(f"Header mapping notice: Detected headers {fieldnames}. Using fallbacks where necessary.")

        items = []
        restock_items = []
        counts = {'total': 0, 'critical': 0, 'low': 0, 'sufficient': 0, 'malformed_rows': 0}

        for row_idx, row in enumerate(reader, start=2):
            # Check if row is completely empty
            if not row or all(v is None or str(v).strip() == '' for v in row.values()):
                continue

            counts['total'] += 1
            item_name = (row.get(item_col) or f"Unknown Item (Row {row_idx})").strip() if item_col else f"Item {row_idx}"

            # Parse quantity
            raw_qty = row.get(qty_col) if qty_col else list(row.values())[1] if len(row) > 1 else None
            current_qty, qty_warn = self.parse_number(raw_qty, default=0.0)
            if qty_warn:
                warnings.append(f"Row {row_idx} [{item_name}]: {qty_warn}")

            # Parse reorder threshold
            raw_thresh = row.get(thresh_col) if thresh_col else list(row.values())[2] if len(row) > 2 else None
            reorder_threshold, thresh_warn = self.parse_number(raw_thresh, default=10.0)
            if thresh_warn:
                warnings.append(f"Row {row_idx} [{item_name}]: {thresh_warn}")

            # Parse optional target stock
            raw_target = row.get(target_col) if target_col else None
            default_target = max(reorder_threshold * 2, reorder_threshold + 10)
            target_stock, _ = self.parse_number(raw_target, default=default_target)
            if target_stock is None or target_stock < reorder_threshold:
                target_stock = default_target

            # Evaluate Stock Conditionals
            reorder_needed = current_qty < reorder_threshold

            if current_qty == 0 or current_qty <= (reorder_threshold * self.critical_ratio):
                priority = "Critical"
                status_code = "CRITICAL"
                counts['critical'] += 1
            elif reorder_needed:
                priority = "Low"
                status_code = "LOW"
                counts['low'] += 1
            else:
                priority = "Sufficient"
                status_code = "SUFFICIENT"
                counts['sufficient'] += 1

            # Calculate Suggested Reorder Quantity
            suggested_reorder = max(0.0, target_stock - current_qty) if reorder_needed else 0.0

            item_dict = {
                'id': row_idx - 1,
                'item_name': item_name,
                'current_quantity': int(current_qty) if current_qty.is_integer() else round(current_qty, 2),
                'reorder_threshold': int(reorder_threshold) if reorder_threshold.is_integer() else round(reorder_threshold, 2),
                'target_stock': int(target_stock) if target_stock.is_integer() else round(target_stock, 2),
                'reorder_needed': reorder_needed,
                'priority': priority,
                'status': status_code,
                'suggested_reorder': int(suggested_reorder) if suggested_reorder.is_integer() else round(suggested_reorder, 2),
            }

            items.append(item_dict)
            if reorder_needed:
                restock_items.append(item_dict)

        return {
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'total_items': counts['total'],
            'restock_needed_count': len(restock_items),
            'summary_counts': counts,
            'items': items,
            'restock_items': restock_items,
            'warnings': warnings,
            'reflection_note': REFLECTION_NOTE.strip(),
        }


def generate_console_report(scan_results: Dict[str, Any]) -> str:
    """Generates a clean text report suitable for printing to console or viewing."""
    lines = []
    lines.append("================================================================================")
    lines.append("                     WAREHOUSE RESTOCK NEEDED REPORT                            ")
    lines.append("================================================================================")
    lines.append(f" Scan Date/Time    : {scan_results.get('timestamp')}")
    lines.append(f" Total Items Scanned: {scan_results.get('total_items')}")
    lines.append(f" Restock Required  : {scan_results.get('restock_needed_count')} items")
    lines.append(f" Breakdown         : Critical: {scan_results['summary_counts']['critical']} | Low: {scan_results['summary_counts']['low']} | OK: {scan_results['summary_counts']['sufficient']}")
    lines.append("--------------------------------------------------------------------------------")

    restock_items = scan_results.get('restock_items', [])
    if not restock_items:
        lines.append(" ALL ITEMS ARE HEALTHY - NO RESTOCKING NEEDED TODAY!")
    else:
        lines.append(f"{'PRIORITY':<10} | {'ITEM NAME':<30} | {'CURRENT':<8} | {'THRESH':<8} | {'REORDER QTY':<11}")
        lines.append("-" * 80)
        for item in restock_items:
            priority_tag = f"[{item['priority'].upper()}]"
            lines.append(f"{priority_tag:<10} | {item['item_name']:<30} | {item['current_quantity']:<8} | {item['reorder_threshold']:<8} | {item['suggested_reorder']:<11}")

    warnings = scan_results.get('warnings', [])
    if warnings:
        lines.append("\n" + "-" * 80)
        lines.append(" PARSING WARNINGS & DIAGNOSTICS:")
        for w in warnings:
            lines.append(f"  • {w}")

    lines.append("\n" + REFLECTION_NOTE.strip())
    lines.append("================================================================================")
    return "\n".join(lines)


def generate_email_alert(scan_results: Dict[str, Any]) -> Dict[str, str]:
    """
    BONUS FEATURE: Formats scan report into a realistic automated email body (Subject + Message).
    Returns dict with 'subject' and 'body'.
    """
    total = scan_results.get('total_items', 0)
    restock_count = scan_results.get('restock_needed_count', 0)
    critical_count = scan_results['summary_counts']['critical']

    subject = f"🚨 [WAREHOUSE ALERT] {restock_count} Item(s) Require Restocking ({critical_count} Critical)"
    
    body = []
    body.append("Hello Warehouse Operations Team,")
    body.append("")
    body.append(f"This is an automated morning restock alert generated on {scan_results.get('timestamp')}.")
    body.append(f"Out of {total} items scanned, {restock_count} item(s) are running low and require replenishment.")
    body.append("")
    body.append(f"Summary Status:")
    body.append(f"  • Critical Action Items (Stock <= 25% threshold or 0): {critical_count}")
    body.append(f"  • Low Stock Warning Items: {scan_results['summary_counts']['low']}")
    body.append(f"  • Sufficient Items: {scan_results['summary_counts']['sufficient']}")
    body.append("")
    body.append("REPLENISHMENT ACTION PLAN:")
    body.append("--------------------------------------------------------------------------------")
    body.append(f"{'Priority':<10} | {'Item Name':<30} | {'Current':<8} | {'Threshold':<10} | {'Suggested Reorder':<18}")
    body.append("--------------------------------------------------------------------------------")

    for item in scan_results.get('restock_items', []):
        body.append(f"{item['priority']:<10} | {item['item_name']:<30} | {item['current_quantity']:<8} | {item['reorder_threshold']:<10} | {item['suggested_reorder']:<18}")

    body.append("--------------------------------------------------------------------------------")
    body.append("")
    body.append("Please verify inventory physically and submit purchase orders accordingly.")
    body.append("")
    body.append("Best regards,")
    body.append("Quiet Backend Inventory Automation Bot 🤖")
    body.append("")
    body.append(REFLECTION_NOTE.strip())

    return {
        'subject': subject,
        'body': "\n".join(body)
    }


def export_restock_csv(scan_results: Dict[str, Any], output_path: str = "restock_report.csv") -> str:
    """
    BONUS FEATURE: Exports restock items to a CSV report file.
    """
    restock_items = scan_results.get('restock_items', [])
    fieldnames = ['Item Name', 'Current Quantity', 'Reorder Threshold', 'Target Stock', 'Priority Level', 'Suggested Reorder Qty']

    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(fieldnames)
        for item in restock_items:
            writer.writerow([
                item['item_name'],
                item['current_quantity'],
                item['reorder_threshold'],
                item['target_stock'],
                item['priority'],
                item['suggested_reorder']
            ])
    return os.path.abspath(output_path)


# CLI Execution Entrypoint
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Warehouse Stock Scanner & Restock Reporting Tool")
    parser.add_argument("csv_file", nargs="?", default="sample_stock.csv", help="Path to input stock CSV file")
    parser.add_argument("--export", help="Output path for restock_report.csv", default=None)
    parser.add_argument("--email", action="store_true", help="Print simulated email alert format")
    args = parser.parse_args()

    file_path = args.csv_file
    if not os.path.exists(file_path):
        print(f"Error: CSV file '{file_path}' not found.", file=sys.stderr)
        sys.exit(1)

    scanner = StockScanner()
    results = scanner.scan_data(file_path)

    # Print Console Summary
    print(generate_console_report(results))

    # Print Email Alert if requested
    if args.email:
        print("\n" + "="*80)
        print("SIMULATED EMAIL ALERT PREVIEW:")
        print("="*80)
        email_data = generate_email_alert(results)
        print(f"SUBJECT: {email_data['subject']}\n")
        print(email_data['body'])

    # Export CSV if requested
    if args.export:
        export_file = export_restock_csv(results, args.export)
        print(f"\n[SUCCESS] Exported restock report to: {export_file}")
