from django.urls import path
from .views import stream_transaction, get_rules, get_transaction_by_id, create_rule, delete_rule, update_rule, update_transaction_status,test_rule,analytics_stats,analytics_types,analytics_channels,analytics_detailed_stats, analytics_status_distribution, get_all_transactions,export_transactions
from .views import create_ml_rule, test_ml_rule, ml_probability

urlpatterns = [
     path("transactions/", get_all_transactions, name="get_all_transactions"),
     path("transactions/stream/", stream_transaction, name="stream_transaction"),
     path("transactions/export/", export_transactions, name="export_transactions"),
     path("transactions/<str:correlation_id>/", get_transaction_by_id, name="get_transaction_by_id"),
     path('transactions/<str:correlation_id>/status/', update_transaction_status, name="update_transaction_status"),
     path("rules/", get_rules, name="get_rules"),
     path("rules/<str:rule>/<int:id>/", get_rules, name="get_rule_by_id"),
     path("rules/create/", create_rule, name="create_rule"),
     path("rules/delete/<str:rule>/<int:id>/", delete_rule, name="delete_rule"),
     path("rules/update/<str:rule>/<int:id>/", update_rule, name="update_rule"),
     path("rules/test/", test_rule, name="test_rule"),
     path("rules/ml/create/", create_ml_rule, name="create_ml_rule"),
     path("rules/ml/test/<int:id>/", test_ml_rule, name="test_ml_rule"),
     path('analytics/stats/', analytics_stats, name='analytics_stats'),
     path('analytics/types/', analytics_types, name='analytics_types'),
     path('analytics/statuses/', analytics_status_distribution, name='analytics_statuses'),
     path('analytics/channels/', analytics_channels, name='analytics_channels'),
     path('analytics/detailed/', analytics_detailed_stats, name='analytics_detailed'),
     path("ml/<str:tx_id>/", ml_probability, name="ml_probability"),
]
