import os
import json
import io
import csv
from django.http import JsonResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.views import View

from stock_scanner import StockScanner, generate_console_report, generate_email_alert, REFLECTION_NOTE
from .models import StockScanRecord, ManagedStockItem

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@csrf_exempt
def health_check(request):
    """API health status endpoint."""
    return JsonResponse({
        'status': 'online',
        'system': 'Warehouse Stock Scanner API',
        'version': '1.0.0'
    })


@method_decorator(csrf_exempt, name='dispatch')
class ScanCSVView(View):
    """
    POST /api/scan/
    Accepts CSV file upload via multipart/form-data or raw CSV content in JSON body.
    Scans data using StockScanner engine and returns scan results, diagnostic warnings,
    priority breakdowns, simulated email body, and reflection note.
    """
    def post(self, request):
        csv_content = None
        filename = "uploaded_stock.csv"

        if request.FILES and 'file' in request.FILES:
            uploaded_file = request.FILES['file']
            filename = uploaded_file.name
            csv_content = uploaded_file.read().decode('utf-8', errors='replace')
        elif request.body:
            try:
                data = json.loads(request.body.decode('utf-8'))
                csv_content = data.get('csv_text')
                filename = data.get('filename', 'raw_text_scan.csv')
            except Exception:
                csv_content = request.body.decode('utf-8', errors='replace')

        if not csv_content or not csv_content.strip():
            return JsonResponse({'error': 'No CSV content or file provided.'}, status=400)

        scanner = StockScanner()
        results = scanner.scan_data(csv_content)

        # Generate Email Alert format
        email_data = generate_email_alert(results)

        # Generate Text Console Report
        console_report = generate_console_report(results)

        # Optionally save scan record
        try:
            StockScanRecord.objects.create(
                filename=filename,
                total_items=results['total_items'],
                restock_count=results['restock_needed_count'],
                critical_count=results['summary_counts']['critical'],
                low_count=results['summary_counts']['low'],
                results_json=results
            )
        except Exception:
            pass

        return JsonResponse({
            'success': True,
            'filename': filename,
            'scan_results': results,
            'email_alert': email_data,
            'console_report': console_report,
            'reflection_note': REFLECTION_NOTE.strip()
        })


@csrf_exempt
def get_sample_csv(request):
    """
    GET /api/sample-csv/?type=standard|edge
    Serves predefined sample stock CSV contents.
    """
    sample_type = request.GET.get('type', 'standard')
    file_name = "sample_edge_case_stock.csv" if sample_type == 'edge' else "sample_stock.csv"
    file_path = os.path.join(BASE_DIR, file_name)

    if not os.path.exists(file_path):
        return JsonResponse({'error': f'Sample CSV file {file_name} not found.'}, status=404)

    with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()

    return JsonResponse({
        'type': sample_type,
        'filename': file_name,
        'csv_content': content
    })


@method_decorator(csrf_exempt, name='dispatch')
class ExportRestockCSVView(View):
    """
    POST /api/export-restock-csv/
    Generates downloadable restock_report.csv from provided items or scan results.
    """
    def post(self, request):
        try:
            data = json.loads(request.body.decode('utf-8'))
            items = data.get('restock_items', [])
        except Exception:
            items = []

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="restock_report.csv"'

        writer = csv.writer(response)
        writer.writerow(['Item Name', 'Current Quantity', 'Reorder Threshold', 'Target Stock', 'Priority Level', 'Suggested Reorder Qty'])

        for item in items:
            writer.writerow([
                item.get('item_name', ''),
                item.get('current_quantity', 0),
                item.get('reorder_threshold', 0),
                item.get('target_stock', 0),
                item.get('priority', 'Low'),
                item.get('suggested_reorder', 0)
            ])

        return response
