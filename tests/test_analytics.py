"""Test script for Hubitat Pandas analytics methods."""

import unittest
from unittest.mock import MagicMock
import pandas as pd
from services.sandbox.sdk.home.hubitat import HubitatClient

class TestHubitatAnalytics(unittest.TestCase):
    def setUp(self):
        self.client = HubitatClient(hub_host="http://mock-hub")
        self.client.device_details = MagicMock(return_value={"label": "Living Room Thermostat", "name": "LR Thermostat"})
        
        # Sample mock temperature events
        self.client.device_history = MagicMock(return_value=[
            {"date": "2026-09-17T10:00:00Z", "name": "temperature", "value": "70.5", "unit": "°F"},
            {"date": "2026-09-17T12:00:00Z", "name": "temperature", "value": "73.0", "unit": "°F"},
            {"date": "2026-09-17T14:00:00Z", "name": "temperature", "value": "71.2", "unit": "°F"},
            {"date": "2026-09-17T16:00:00Z", "name": "temperature", "value": "69.8", "unit": "°F"},
        ])

    def test_get_metric_dataframe(self):
        df = self.client.get_metric_dataframe(123, attribute="temperature", days=1.0)
        self.assertFalse(df.empty)
        self.assertEqual(len(df), 4)
        self.assertEqual(df["value"].min(), 69.8)
        self.assertEqual(df["value"].max(), 73.0)
        print("Metric DataFrame:\n", df[["timestamp", "device_name", "value"]])

    def test_temperature_summary(self):
        summary_df = self.client.temperature_summary(device_ids=[123], days=1.0)
        self.assertFalse(summary_df.empty)
        row = summary_df.iloc[0]
        self.assertEqual(row["device_name"], "Living Room Thermostat")
        self.assertEqual(row["min"], 69.8)
        self.assertEqual(row["max"], 73.0)
        self.assertEqual(row["delta"], 3.2)
        print("\nTemperature Summary:\n", summary_df.to_markdown())

    def test_energy_consumption(self):
        # Mock power events in watts
        self.client.device_details = MagicMock(return_value={"label": "Office Computer Outlet"})
        self.client.device_history = MagicMock(return_value=[
            {"date": "2026-09-17T10:00:00Z", "name": "power", "value": "150.0", "unit": "W"},
            {"date": "2026-09-17T12:00:00Z", "name": "power", "value": "200.0", "unit": "W"}, # 2 hours @ 175W avg = 0.35 kWh
            {"date": "2026-09-17T14:00:00Z", "name": "power", "value": "100.0", "unit": "W"}, # 2 hours @ 150W avg = 0.30 kWh
        ])
        energy_df = self.client.energy_consumption(device_ids=[456], days=1.0)
        self.assertFalse(energy_df.empty)
        row = energy_df.iloc[0]
        self.assertEqual(row["device_name"], "Office Computer Outlet")
        self.assertAlmostEqual(row["total_kwh"], 0.65, places=2)
        print("\nEnergy Consumption Summary:\n", energy_df.to_markdown())

if __name__ == "__main__":
    unittest.main()
