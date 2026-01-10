import ipaddress
import re, html
from rest_framework import serializers
from django.utils import timezone
from .models import ThresholdRule, CompositeRule, PatternRule 
from django.core.exceptions import ValidationError
from .models import MLRule


SAFE_TEXT_FIELDS = {"location", "merchant_category"}
ID_LIKE_FIELDS = {"transaction_id", "correlation_id", "sender_account", "receiver_account", "device_hash", "payment_channel"}

def sanitize_record(data: dict) -> dict:
    clean = {}
    for k, v in data.items():
        if isinstance(v, str):
            v = v.strip()
            v = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", v)
            if k in SAFE_TEXT_FIELDS:
                v = html.escape(v)[:255]
            if v == "" and k == "time_since_last_transaction":
                v = 0.0
        if k in {"time_since_last_transaction","spending_deviation_score","velocity_score","geo_anomaly_score"} and v is not None:
            try: v = float(v)
            except: v = 0.0 if k=="time_since_last_transaction" else None
        clean[k] = v
    return clean


class TransactionSerializer(serializers.Serializer):
    transaction_id   = serializers.CharField(max_length=20)
    correlation_id   = serializers.CharField(required=True, allow_blank=False, max_length=64)
    timestamp = serializers.DateTimeField(
        input_formats=[
            "%d.%m.%Y %H:%M",
            "%Y-%m-%dT%H:%M:%S.%f",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d %H:%M:%S.%f",
            "%Y-%m-%d %H:%M:%S",
        ]
    )
    sender_account   = serializers.RegexField(r"^ACC\d+$")
    receiver_account = serializers.RegexField(r"^ACC\d+$")
    amount = serializers.FloatField(min_value=0.01)
    transaction_type  = serializers.ChoiceField(["withdrawal","deposit","transfer","payment"])
    merchant_category = serializers.CharField(max_length=50, required=False, allow_blank=True)
    location          = serializers.CharField(max_length=50, required=False, allow_blank=True)
    device_used       = serializers.ChoiceField(["mobile","atm","pos","web"])
    ip_address = serializers.IPAddressField(required=False, protocol="ipv4", allow_null=True)
    time_since_last_transaction = serializers.FloatField(required=False, allow_null=True, default=0.0)
    spending_deviation_score    = serializers.FloatField(required=False, allow_null=True)
    velocity_score              = serializers.FloatField(required=False, allow_null=True)
    geo_anomaly_score           = serializers.FloatField(required=False, allow_null=True)
    payment_channel             = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=20)
    device_hash                 = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=64)
    status = serializers.CharField(required=False, allow_null=True)
    is_fraud = serializers.BooleanField(required=False, allow_null=True)
    is_reviewed = serializers.BooleanField(required=False, allow_null=True)
 
    def validate(self, data):
        if data["amount"] <= 0:
            raise serializers.ValidationError("Сумма транзакции должна быть положительной.")
        if data["timestamp"] > timezone.now():
            raise serializers.ValidationError("Дата транзакции не может быть в будущем.")
        ip_str = data.get("ip_address")
        if ip_str:
            ip = ipaddress.ip_address(ip_str) 
            if ip.is_unspecified: 
                raise serializers.ValidationError("Недопустимый IPv4 (unspecified).")
            if str(ip) == "255.255.255.255":  
                raise serializers.ValidationError("Недопустимый IPv4 (broadcast).")
        return data
    

class ThresholdRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ThresholdRule
        fields = "__all__"


class CompositeRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompositeRule
        fields = "__all__"

    def validate_rule(self, value):

        temp_rule = CompositeRule(rule=value)
        try:
            temp_rule.clean()
        except ValidationError as e:
            raise serializers.ValidationError(e.messages)
        return value


class PatternRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = PatternRule
        fields = "__all__"


class MLRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = MLRule
        fields = "__all__"

    def validate_threshold(self, value):
        if value < 0 or value > 1:
            raise serializers.ValidationError("Порог должен быть между 0 и 1")
        return value

    def validate_model_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Название модели обязательно")
        return value

