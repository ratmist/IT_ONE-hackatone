from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView)
from drf_spectacular.utils import extend_schema


@extend_schema(tags=["Schema"], summary="Эндпоинт для получения OpenAPI схемы")
class CustomSpectacularAPIView(SpectacularAPIView):
    pass


urlpatterns = [
    path("api/schema/", CustomSpectacularAPIView.as_view(), name="schema"),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    path('api/redoc/', SpectacularRedocView.as_view(url_name='schema'), name='redoc'),
    
    path('admin/', admin.site.urls),
    path('api/', include('transactions.urls')),
    path('', include('django_prometheus.urls')),
]
