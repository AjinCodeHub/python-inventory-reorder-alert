## Python-Inventory-Reorder-Alert


An automated supply chain intelligence and stock scanning system built with **Python (Django)** and **React**. Designed to mirror the quiet morning backend automation job that warehouse operations rely on to ensure inventory never quietly runs dry.

---

## Table of Contents
- [Overview](#-overview)
- [Key Features](#-key-features)
- [Bonus Objectives Implemented](#-bonus-objectives-implemented)
- [Directory Structure](#-directory-structure)
- [Prerequisites](#-prerequisites)
- [Installation & Setup](#-installation--setup)
  - [1. Backend Setup (Django & Python CLI)](#1-backend-setup-django--python-cli)
  - [2. Frontend Setup (React + Vite)](#2-frontend-setup-react--vite)
- [Usage Guide](#-usage-guide)
  - [Running the Standalone Python CLI Scanner](#running-the-standalone-python-cli-scanner)
  - [Running the Full Web Application](#running-the-full-web-application)
- [API Endpoints](#-api-endpoints)
- [Edge-Case Handling & Resilience](#-edge-case-handling--resilience)
- [Reflection & Architectural Insights](#-reflection--architectural-insights)

---

## Overview

This system scans warehouse stock CSV data, compares item quantities against reorder thresholds using conditional logic, flags items needing replenishment, and generates action-oriented restock reports.

Whether operated via the **standalone command-line script** (`stock_scanner.py`) or through the **interactive React web dashboard**, the system provides daily visibility into inventory health, priority urgency levels, and suggested reorder quantities.

---

## Key Features

1. **Robust CSV File Parsing**: Parses stock data into clean dictionary structures (`item_name`, `current_quantity`, `reorder_threshold`, `target_stock`). Automatically maps dynamic column headers (e.g. `Item Name`, `Product`, `Qty`, `Threshold`, `Min Stock`).
2. **Conditional Stock Logic**: Automatically compares `current_quantity` vs `reorder_threshold` to isolate items running low.
3. **Priority Level Classification**:
   - **Critical**: Items with `0` stock or stock `≤ 25%` of threshold.
   - **Low**: Items below threshold but above 25%.
   - **Sufficient**: Items meeting or exceeding reorder threshold.
4. **Reorder Quantity Calculation**: Calculates exact replenishment units required (`target_stock - current_quantity`).
5. **Interactive Operations Dashboard**: Built with React (Vite) featuring drag-and-drop CSV upload, live item search, priority filter pills, and real-time status badges.

---

## Bonus Objectives Implemented

- **Simulated Email Alert**: Automatically formats scan results into an email subject & body (`[WAREHOUSE ALERT] 7 Item(s) Require Restocking...`) complete with a "Copy to Clipboard" feature in the UI.
- **Priority Levels (Critical vs Low)**: Replaced single flat flags with dynamic multi-tier priority badges.
- **Reorder Quantity Suggestion**: Computes target restock quantities per item rather than just flagging low status.
- **Export as CSV Report**: Generates and downloads `restock_report.csv` directly from CLI or UI.
- **Reflection Note**: Embedded architectural analysis detailing production improvements for scheduling, supplier APIs, dynamic thresholds, and multi-warehouse tracking.

---

## Directory Structure

```text
Inventory_Record_System/
├── backend/
│   ├── inventory/                  # Django app (models, views, urls, admin)
│   ├── warehouse_management/       # Django project configuration & settings
│   ├── stock_scanner.py            # Standalone Python scanner & CLI engine
│   ├── sample_stock.csv            # Standard stock CSV sample file
│   ├── sample_edge_case_stock.csv  # Malformed & edge-case test CSV file
│   ├── restock_report.csv          # Generated export file
│   ├── db.sqlite3                  # SQLite database
│   └── manage.py
├── frontend/
│   ├── src/
│   │   ├── App.jsx                 # Interactive React dashboard component
│   │   ├── index.css               # Glassmorphism dark design system
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── env/                            # Python virtual environment
├── README.md                       # Project documentation
└── .gitignore
```

---

## Prerequisites

- **Python**: 3.10+ (Python 3.12 recommended)
- **Node.js**: v18+ & **npm**: v9+
- **OS**: Windows, macOS, or Linux

---

## Installation & Setup

### 1. Backend Setup (Django & Python CLI)

1. Open your terminal in the `backend/` directory:
   ```bash
   cd backend
   ```

2. Activate the virtual environment (`env`):
   - **Windows (PowerShell/CMD)**:
     ```powershell
     ..\env\Scripts\activate
     ```
   - **macOS/Linux**:
     ```bash
     source ../env/bin/activate
     ```

3. Install requirements (Django, `django-cors-headers`):
   ```bash
   pip install django django-cors-headers
   ```

4. Run database migrations:
   ```bash
   python manage.py migrate
   ```

---

### 2. Frontend Setup (React + Vite)

1. Open a new terminal in the `frontend/` directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

---

## Usage Guide

### Running the Standalone Python CLI Scanner

Run `stock_scanner.py` directly from the command line using standard Python:

```bash
cd backend

# 1. Standard scan with text console report
python stock_scanner.py sample_stock.csv

# 2. Scan and export restock_report.csv + display simulated email alert
python stock_scanner.py sample_stock.csv --export restock_report.csv --email

# 3. Scan edge-case test dataset (tests recovery from malformed rows & strings)
python stock_scanner.py sample_edge_case_stock.csv
```

#### CLI Sample Output:
```text
================================================================================
                     WAREHOUSE RESTOCK NEEDED REPORT                            
================================================================================
 Scan Date/Time    : 2026-07-27 21:13:40
 Total Items Scanned: 10
 Restock Required  : 7 items
 Breakdown         : Critical: 5 | Low: 2 | OK: 3
--------------------------------------------------------------------------------
PRIORITY   | ITEM NAME                      | CURRENT  | THRESH   | REORDER QTY
--------------------------------------------------------------------------------
[CRITICAL] | Heavy Duty Pallet Straps       | 12       | 50       | 138        
[CRITICAL] | Industrial Steel Shelving      | 4        | 20       | 46         
[CRITICAL] | Barcode Scanner Model X        | 0        | 15       | 40         
[CRITICAL] | Forklift Battery Pack          | 1        | 5        | 9          
[LOW]      | Safety Hard Hats               | 8        | 30       | 72         
[LOW]      | Shipping Label Printer         | 3        | 10       | 22         
[CRITICAL] | Cardboard Boxes (Large)        | 15       | 100      | 285        
================================================================================
```

---

### Running the Full Web Application

1. **Start Django REST Server** (Port 8000):
   ```bash
   cd backend
   python manage.py runserver 8000
   ```

2. **Start React Frontend Dev Server** (Port 5173):
   ```bash
   cd frontend
   npm run dev
   ```

3. Open your browser and navigate to:
   ```text
   http://localhost:5173
   ```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health/` | API sanity and health check |
| `POST` | `/api/scan/` | Upload CSV file or raw CSV text payload for scanning |
| `GET` | `/api/sample-csv/?type=standard` | Fetch built-in CSV sample data (`standard` or `edge`) |
| `POST` | `/api/export-restock-csv/` | Returns downloadable `restock_report.csv` attachment |

---

## Edge-Case Handling & Resilience

The stock scanning engine includes safeguards against invalid or messy real-world warehouse data:

- **Non-Numeric Stock Values**: Interprets values like `"OUT_OF_STOCK"`, `"NONE"`, `"N/A"` as `0.0` stock and flags a warning.
- **Negative Stock**: Automatically normalizes negative quantities (e.g. `"-2"`) to `0.0` stock.
- **Missing Columns / Empty Cells**: Applies fallback thresholds and records row-level diagnostic warnings without stopping script execution.
- **Header Alias Mapping**: Recognizes `Product Name`, `Item`, `Quantity`, `Qty`, `Threshold`, `Reorder Level`, `Target Stock`.

---

## Reflection & Architectural Insights

> **"What would you improve with more time?"**

1. **Automated Scheduling (Celery + Redis / Cron)**:
   Integrate scheduled background tasks to execute the scan automatically every morning at 06:00 AM before warehouse shifts begin.
2. **Supplier EDI & API Integration**:
   Connect via REST/EDI APIs to automatically generate draft Purchase Orders (POs) for items marked with `Critical` priority.
3. **Dynamic Reorder Thresholds**:
   Replace static thresholds with dynamic safety stock calculated from a 30-day moving average consumption rate and supplier lead times.
4. **Multi-Warehouse Bin Tracking**:
   Extend data schemas to track stock across distribution centers, aisle/rack/bin coordinates, and lot expiration dates.

---

## License
This project is open-source and available under the [MIT License](LICENSE).
