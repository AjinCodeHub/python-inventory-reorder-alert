from django.db import models

class StockScanRecord(models.Model):
    scanned_at = models.DateTimeField(auto_now_add=True)
    filename = models.CharField(max_length=255, default="uploaded_stock.csv")
    total_items = models.IntegerField(default=0)
    restock_count = models.IntegerField(default=0)
    critical_count = models.IntegerField(default=0)
    low_count = models.IntegerField(default=0)
    results_json = models.JSONField(default=dict)

    def __str__(self):
        return f"Scan {self.id} - {self.filename} ({self.scanned_at.strftime('%Y-%m-%d %H:%M')})"


class ManagedStockItem(models.Model):
    item_name = models.CharField(max_length=255, unique=True)
    current_quantity = models.FloatField(default=0)
    reorder_threshold = models.FloatField(default=10)
    target_stock = models.FloatField(default=30)
    last_updated = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.item_name} ({self.current_quantity}/{self.reorder_threshold})"
