from django.utils import timezone
from django.core.exceptions import ValidationError
from django.db import models


class Transaction(models.Model):
    STATUS_PROCESSED = "processed"
    STATUS_ALERTED   = "alerted"
    STATUS_CHOICES = [
        (STATUS_PROCESSED, "Processed"),
        (STATUS_ALERTED,   "Alerted"),
    ]

    transaction_id = models.CharField(max_length=64, unique=True, db_index=True)
    correlation_id = models.CharField(max_length=64, db_index=True)  # НЕ уникальный
    timestamp = models.DateTimeField(null=True, blank=True, db_index=True)
    sender_account = models.CharField(max_length=32, db_index=True)
    receiver_account = models.CharField(max_length=32, db_index=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    transaction_type = models.CharField(max_length=30, null=True, blank=True)
    merchant_category = models.CharField(max_length=50, null=True, blank=True)
    location = models.CharField(max_length=50, null=True, blank=True)
    device_used = models.CharField(max_length=20, null=True, blank=True)
    time_since_last_transaction = models.FloatField(null=True, blank=True)
    spending_deviation_score = models.FloatField(null=True, blank=True)
    velocity_score = models.FloatField(null=True, blank=True)
    geo_anomaly_score = models.FloatField(null=True, blank=True)
    payment_channel = models.CharField(max_length=20, null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    device_hash = models.CharField(max_length=64, null=True, blank=True)
    is_fraud = models.BooleanField(default=False)     
    is_reviewed = models.BooleanField(default=False)  

    status = models.CharField(
        max_length=16,
        choices=STATUS_CHOICES,
        null=True, blank=True,           
        db_index=True,
    )

    class Meta:
        db_table = "transactions"
        verbose_name = "Transaction"
        verbose_name_plural = "Transactions"
        indexes = [
            models.Index(fields=["status", "is_reviewed"]),
            models.Index(fields=["sender_account", "receiver_account"]),
            models.Index(fields=["correlation_id", "timestamp"]),
        ]

    def __str__(self):
        return f"{self.transaction_id} — {self.amount} ₽"

CRIT_CHOICES = [
    ("low", "Low"),
    ("medium", "Medium"),
    ("high", "High"),
    ("critical", "Critical"),
]

class ThresholdRule(models.Model):
    title = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    column_name = models.CharField(max_length=50)
    operator = models.CharField(max_length=5)  
    value = models.FloatField()
    username = models.CharField(max_length=150, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    is_active = models.BooleanField(default=False)
    criticality = models.CharField(max_length=10, choices=CRIT_CHOICES, default="low")

    class Meta:
        db_table = "threshold_rules"
        indexes = [
            models.Index(fields=["is_active"]),
            models.Index(fields=["is_active", "created_at", "id"]),
        ]
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.title} ({self.column_name} {self.operator} {self.value})"

    def clean(self):
        allowed_ops = {">", ">=", "<", "<=", "==", "!="}

        if not self.column_name or not self.column_name.strip():
            raise ValidationError("Поле 'column_name' не может быть пустым.")

        if self.operator not in allowed_ops:
            raise ValidationError(
                f"Недопустимый оператор '{self.operator}'. Допустимо: {', '.join(sorted(allowed_ops))}"
            )

        if self.value is None:
            raise ValidationError("Поле 'value' должно быть указано.")
        try:
            float(self.value)
        except (TypeError, ValueError):
            raise ValidationError("Поле 'value' должно быть числом.")


class CompositeRule(models.Model):
    title = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    rule = models.JSONField()
    username = models.CharField(max_length=150, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=False)
    criticality = models.CharField(max_length=10, choices=CRIT_CHOICES, default="low")

    class Meta:
        db_table = "composite_rules"
        indexes = [
            models.Index(fields=["is_active"]),
            models.Index(fields=["is_active", "created_at", "id"]),
        ]
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.title}"

    def clean(self):
        if not isinstance(self.rule, dict):
            raise ValidationError("Поле 'rule' должно быть объектом JSON (dict).")
        self._validate_rule_structure(self.rule)

    def _validate_rule_structure(self, node):
        allowed_logics = {"AND", "OR", "NOT"}
        stack = [node]
        while stack:
            current = stack.pop()

            if "column" in current:
                for key in ("column", "operator", "value"):
                    if key not in current:
                        raise ValidationError(f"Отсутствует обязательное поле '{key}' в листе правила")
                if current.get("operator") not in {">", ">=", "<", "<=", "==", "!="}:
                    raise ValidationError(f"Недопустимый оператор '{current.get('operator')}' в листе")
                continue

            logic = current.get("logic")
            conditions = current.get("conditions")
            if logic not in allowed_logics:
                raise ValidationError(f"Недопустимый logic: {logic}")
            if not isinstance(conditions, list) or not conditions:
                raise ValidationError("Поле 'conditions' должно быть непустым списком.")
            if logic == "NOT" and len(conditions) != 1:
                raise ValidationError("Оператор 'NOT' должен иметь ровно одно подусловие.")
            stack.extend(conditions)


class PatternRule(models.Model):
    title = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    window_seconds = models.PositiveIntegerField(default=600) 
    min_count = models.PositiveIntegerField(default=3)
    total_amount_limit = models.FloatField(null=True, blank=True)  
    min_amount_limit = models.FloatField(null=True, blank=True)    
    
    group_mode = models.CharField(
        max_length=20,
        choices=[
            ("sender", "Только отправитель"),
            ("receiver", "Только получатель"),
            ("pair", "Пара отправитель–получатель"),
        ],
        default="sender",
    )

    username = models.CharField(max_length=150, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=False)
    criticality = models.CharField(max_length=10, choices=CRIT_CHOICES, default="low")

    class Meta:
        db_table = "pattern_rules"
        verbose_name = "Паттерновое правило"
        verbose_name_plural = "Паттерновые правила"
        indexes = [
            models.Index(fields=["is_active"]),
            models.Index(fields=["is_active", "created_at", "id"]),
        ]
        ordering = ["created_at", "id"]

    def __str__(self):
       
        if self.window_seconds < 60:
            dur = f"{self.window_seconds} сек"
        elif self.window_seconds % 60 == 0:
            dur = f"{self.window_seconds // 60} мин"
        else:
            dur = f"{self.window_seconds / 60:.1f} мин"
        return f"{self.title} (окно {dur}, N≥{self.min_count})"

    def clean(self):
        if self.window_seconds <= 0:
            raise ValidationError("Длительность окна должна быть больше 0 секунд.")
        if self.min_count <= 0:
            raise ValidationError("Количество операций (min_count) должно быть > 0.")
        

class MLRule(models.Model):
    title = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    threshold = models.FloatField(default=0.8)
    model_name = models.CharField(max_length=200, default="ModSpecialization/distilbert-base-uncased-fraud-classifer")
    input_template = models.TextField(
        default="Transaction {transaction_type} amount {amount} from {sender_account} to {receiver_account} at {timestamp} location {location}",
        help_text="Шаблон для преобразования транзакции в текст"
    )
    is_active = models.BooleanField(default=False)
    username = models.CharField(max_length=150, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    criticality = models.CharField(max_length=10, choices=CRIT_CHOICES, default="low")

    class Meta:
        db_table = "ml_rules"
        verbose_name = "ML правило"
        verbose_name_plural = "ML правила"
        indexes = [
            models.Index(fields=["is_active"]),
            models.Index(fields=["is_active", "created_at", "id"]),
        ]
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.title} (порог: {self.threshold})"

    def clean(self):
        if self.threshold < 0 or self.threshold > 1:
            raise ValidationError("Порог должен быть между 0 и 1")
        if not self.model_name.strip():
            raise ValidationError("Название модели обязательно")
