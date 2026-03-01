#!/usr/bin/env python3
"""
Shared utilities for WMS operations.
"""


def normalize_carrier(raw: str) -> str:
    """
    Normalize carrier name to standard format.
    Used across wms_monitor.py, process_ds_labels.py, and process_ds_labels_custom.py
    """
    if not isinstance(raw, str):
        return "UNKNOWN"
    t = raw.upper()
    if "CBT" in t:
        return "CBT"
    if "USPS" in t:
        return "USPS"
    if "UPS" in t:
        return "UPS"
    if "FEDEX" in t or "FED EX" in t:
        return "FedEx"
    if "GOFO" in t:
        return "Gofo"
    if "UNI" in t:
        return "Uni"
    if "SPEEDX" in t:
        return "SpeedX"
    if "SWIFTX" in t or "SWIFIX" in t:
        return "SwiftX"
    if "YW" in t or "YANWEN" in t:
        return "YW"
    # fallback
    return raw.strip()
