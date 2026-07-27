from django.urls import path
from . import views

urlpatterns = [
    path('health/', views.health_check, name='health_check'),
    path('scan/', views.ScanCSVView.as_view(), name='scan_csv'),
    path('sample-csv/', views.get_sample_csv, name='get_sample_csv'),
    path('export-restock-csv/', views.ExportRestockCSVView.as_view(), name='export_restock_csv'),
]
