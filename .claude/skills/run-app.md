# run-app: Iniciar ResTito localmente

## Build & launch

```bash
# Instalar dependencias si hace falta
cd /home/user/javito && npm install

# Iniciar servidor
node app.js &

# Esperar y verificar
sleep 3 && curl -s http://localhost:3000/admin | head -3
```

El servidor corre en puerto **3000** (o `$PORT` si está definida).

## Rutas para verificar
- http://localhost:3000/admin — módulo admin
- http://localhost:3000/mozo — módulo mozo
- http://localhost:3000/cocina — pantalla cocina
- http://localhost:3000/repartidor — app repartidor

## Apagar
```bash
pkill -f "node app.js"
```
