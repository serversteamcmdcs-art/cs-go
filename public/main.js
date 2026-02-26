/**
 * CS:GO 10000000.16 - Клиентская часть (Main Game Logic)
 * Three.js + Socket.io
 * 
 * Содержит:
 * - Инициализацию Three.js сцены
 * - Управление игроком (WASD + прыжки)
 * - Pointer Lock API для захвата мыши
 * - Синхронизацию с сервером через Socket.io
 */

// ============================================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================================================

// Three.js объекты
let scene, camera, renderer;
let clock; // Для расчета deltaTime

// Игрок
const player = {
    height: 1.8,        // Высота глаз игрока
    speed: 5,          // Скорость движения
    jumpForce: 8,      // Сила прыжка
    velocity: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    onGround: true,
    canJump: true,
    team: null,        // Команда: 'CT' или 'T'
    weapon: null,      // Текущее оружие
    health: 100,        // HP игрока
    maxHealth: 100      // Максимальное HP
};

// Управление
const keys = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false
};

// Глобальные переменные для камеры
let pitch = 0; // Вертикальный поворот
let yaw = 0;   // Горизонтальный поворот
let isLocked = false; // Захвачен ли курсор

// Другие игроки (мультиплеер)
const otherPlayers = {}; // Хранилище других игроков: { socketId: mesh }

// Socket.io
let socket;

// FPS счетчик
let frameCount = 0;
let lastFpsUpdate = 0;

// Пули
const bullets = []; // Массив активных пуль
const BULLET_SPEED = 50; // Скорость пули
const BULLET_LIFETIME = 2; // Время жизни пули в секундах

// ============================================================================
// ИНИЦИАЛИЗАЦИЯ ИГРЫ
// ============================================================================

function init() {
    // Создаем Three.js сцену
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Небесно-голубой
    scene.fog = new THREE.Fog(0x87CEEB, 10, 50); // Туман для глубины

    // Создаем камеру (PerspectiveCamera)
    camera = new THREE.PerspectiveCamera(
        75, // FOV - угол обзора
        window.innerWidth / window.innerHeight, // Соотношение сторон
        0.1, // Near plane
        1000 // Far plane
    );
    camera.position.set(0, player.height, 0);

    // Создаем рендерер
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; // Включаем тени
    document.getElementById('game-container').appendChild(renderer.domElement);

    // Таймер
    clock = new THREE.Clock();

    // Настраиваем освещение
    setupLighting();

    // Создаем оружие
    setupWeapon();

    // Создаем игровой мир
    createWorld();

    // Настраиваем управление
    setupControls();

    // Подключаем Socket.io
    setupSocket();
    
    // Инициализируем HP UI
    updateHealthUI();

    // Обработчик изменения размера окна
    window.addEventListener('resize', onWindowResize);

    // Запускаем игровой цикл
    animate();
}



// ============================================================================
// ОРУЖИЕ
// ============================================================================

// Система оружия
const weapons = {
    current: 'pistol',
    models: {}
};

// Параметры оружий
const WEAPON_CONFIG = {
    pistol: { damage: 25, fireRate: 0.4, isRanged: true, bulletSpeed: 50, bulletLifetime: 2, recoil: 0.1, slot: 1 },
    knife:  { damage: 80, fireRate: 0.8, isRanged: false, meleeRange: 2.5, slot: 2 },
    ak47:   { damage: 35, fireRate: 0.1, isRanged: true, bulletSpeed: 80, bulletLifetime: 1.5, recoil: 0.15, slot: 3 }
};

let lastShotTime = 0;

// Материалы для оружий — используем встроенные из GLB (там уже есть текстуры)
// Если нужно переопределить цвет — можно добавить сюда

// Настройки позиций/поворотов оружий в руке
// Модели ~1.0 единица в длину, центрованы на 0
const WEAPON_TRANSFORM = {
    pistol: {
        position: new THREE.Vector3(0.25, -0.28, -0.45),
        rotation: new THREE.Euler(0, Math.PI, 0),
        scale: 0.55
    },
    knife: {
        position: new THREE.Vector3(0.22, -0.22, -0.42),
        rotation: new THREE.Euler(Math.PI / 2, Math.PI, 0),
        scale: 0.55
    },
    ak47: {
        position: new THREE.Vector3(0.1, -0.25, -0.55),
        rotation: new THREE.Euler(0, Math.PI, 0),
        scale: 0.55
    }
};

function setupWeapon() {
    const loader = new THREE.GLTFLoader();
    let loadedCount = 0;
    const total = 3;

    // ── Отдельная сцена для оружия ──────────────────────────────────────────
    // Свет в weaponScene НЕ попадает на объекты основной сцены
    window.weaponScene = new THREE.Scene();

    // Фоновый свет
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    weaponScene.add(ambient);

    // Основной направленный свет (сверху-спереди)
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(1, 2, 2);
    weaponScene.add(keyLight);

    // Заполняющий свет (снизу, чуть синеватый)
    const fillLight = new THREE.DirectionalLight(0xaaccff, 0.8);
    fillLight.position.set(-1, -1, 1);
    weaponScene.add(fillLight);

    // Отдельная камера для оружия (те же параметры FOV)
    window.weaponCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 10);

    function onLoaded(name, gltf) {
        const cfg = WEAPON_TRANSFORM[name];
        const model = gltf.scene;

        model.position.copy(cfg.position);
        model.rotation.copy(cfg.rotation);
        model.scale.setScalar(cfg.scale);
        model.visible = (name === weapons.current);

        model.traverse(child => {
            if (child.isMesh) {
                child.frustumCulled = false;
            }
        });

        weapons.models[name] = model;
        weaponScene.add(model); // Добавляем в weaponScene, а не в camera/scene

        loadedCount++;
        if (loadedCount === total) {
            scene.add(camera);
            player.weapon = weapons.models[weapons.current];
            updateWeaponHUD();
        }
    }

    function onError(name, color) {
        return (err) => {
            console.error(`Ошибка загрузки ${name}:`, err);
            const group = new THREE.Group();
            group.add(new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.1, 0.4),
                new THREE.MeshLambertMaterial({ color })
            ));
            onLoaded(name, { scene: group });
        };
    }

    loader.load('models/gun.glb',   gltf => onLoaded('pistol', gltf), undefined, onError('gun.glb',   0x555555));
    loader.load('models/knife.glb', gltf => onLoaded('knife',  gltf), undefined, onError('knife.glb', 0xc0c0c0));
    loader.load('models/ak-47.glb', gltf => onLoaded('ak47',   gltf), undefined, onError('ak-47.glb', 0x333333));
}

// Резервная модель — не нужна отдельно, встроена в onError выше
function createFallbackModel(color) {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.1, 0.35),
        new THREE.MeshLambertMaterial({ color })
    ));
    return group;
}

function switchWeapon(weaponName) {
    if (weapons.current === weaponName || !weapons.models[weaponName]) return;

    weapons.models[weapons.current].visible = false;
    weapons.current = weaponName;
    weapons.models[weaponName].visible = true;
    player.weapon = weapons.models[weaponName];
    updateWeaponHUD();

    // Анимация появления — сдвиг вниз и возврат
    const model = weapons.models[weaponName];
    const cfg = WEAPON_TRANSFORM[weaponName];
    const origY = cfg.position.y;
    model.position.y = origY - 0.35;
    const startTime = Date.now();
    (function animateIn() {
        const t = Math.min((Date.now() - startTime) / 150, 1);
        model.position.y = origY - 0.35 + t * 0.35;
        if (t < 1) requestAnimationFrame(animateIn);
        else model.position.y = origY;
    })();
}

function updateWeaponHUD() {
    const slotMap = { pistol: 'slot-1', knife: 'slot-2', ak47: 'slot-3' };
    document.querySelectorAll('.weapon-slot').forEach(el => el.classList.remove('active'));
    const activeSlot = document.getElementById(slotMap[weapons.current]);
    if (activeSlot) activeSlot.classList.add('active');
}




// ============================================================================
// ОСВЕЩЕНИЕ
// ============================================================================

function setupLighting() {
    // HemisphereLight - мягкий окружающий свет (небо + земля)
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    // DirectionalLight - солнечный свет (направленный)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 30;
    dirLight.shadow.camera.bottom = -30;
    dirLight.shadow.camera.left = -30;
    dirLight.shadow.camera.right = 30;
    scene.add(dirLight);
}

// ============================================================================
// СОЗДАНИЕ ИГРОВОГО МИРА
// ============================================================================

function createWorld() {
    // --- ПОЛ (Ground) ---
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x2a2a2a,
        roughness: 0.8
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2; // Поворот на 90 градусов
    ground.receiveShadow = true;
    scene.add(ground);

    // Сетка на полу (Grid)
    const gridHelper = new THREE.GridHelper(100, 50, 0x444444, 0x222222);
    scene.add(gridHelper);

    // --- КУБЫ (Препятствия) ---
    
    // Материал для кубов
    const boxMaterial = new THREE.MeshStandardMaterial({
        color: 0xe94560,
        roughness: 0.5,
        metalness: 0.3
    });

    // Кубические препятствия
    const boxes = [
        { x: 5, y: 1, z: 5, size: 2 },
        { x: -5, y: 1.5, z: 8, size: 3 },
        { x: 8, y: 0.5, z: -5, size: 1 },
        { x: -8, y: 2, z: -8, size: 4 },
        { x: 0, y: 1, z: 15, size: 2 },
        { x: 12, y: 0.75, z: 0, size: 1.5 }
    ];

    boxes.forEach(pos => {
        const geometry = new THREE.BoxGeometry(pos.size, pos.size, pos.size);
        const box = new THREE.Mesh(geometry, boxMaterial);
        box.position.set(pos.x, pos.y, pos.z);
        box.castShadow = true;
        box.receiveShadow = true;
        scene.add(box);
    });

    // --- ДОПОЛНИТЕЛЬНЫЕ ОБЪЕКТЫ ---

    // Колонны
    const columnMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a4a6a,
        roughness: 0.7
    });

    const columns = [
        { x: 15, z: 15 },
        { x: -15, z: 15 },
        { x: 15, z: -15 },
        { x: -15, z: -15 }
    ];

    columns.forEach(pos => {
        const geometry = new THREE.CylinderGeometry(1, 1, 6, 16);
        const column = new THREE.Mesh(geometry, columnMaterial);
        column.position.set(pos.x, 3, pos.z);
        column.castShadow = true;
        column.receiveShadow = true;
        scene.add(column);
    });
}

// ============================================================================
// УПРАВЛЕНИЕ ИГРОКОМ
// ============================================================================

function setupControls() {
    // Кнопка старта
    const startBtn = document.getElementById('start-btn');
    startBtn.addEventListener('click', startGame);
    
    // Выбор команды CT
    document.getElementById('btn-ct').addEventListener('click', () => {
        selectTeam('CT');
    });
    
    // Выбор команды T
    document.getElementById('btn-t').addEventListener('click', () => {
        selectTeam('T');
    });

    // Pointer Lock API - захват мыши
    document.addEventListener('pointerlockchange', onPointerLockChange);

    // Движение мыши - поворот камеры
    document.addEventListener('mousemove', onMouseMove);

    // Клавиши
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    
    // Стрельба (левая кнопка мыши)
    document.addEventListener('mousedown', onMouseDown);
}

function selectTeam(team) {
    player.team = team;
    
    // Обновляем визуальное состояние кнопок
    document.getElementById('btn-ct').classList.remove('selected');
    document.getElementById('btn-t').classList.remove('selected');
    
    if (team === 'CT') {
        document.getElementById('btn-ct').classList.add('selected');
    } else {
        document.getElementById('btn-t').classList.add('selected');
    }
    
    // Активируем кнопку старта
    document.getElementById('start-btn').disabled = false;
    
    // Обновляем цвет оружия в зависимости от команды
    if (player.weapon) {
        const pistolMaterial = player.weapon.children[0].material;
        if (team === 'CT') {
            pistolMaterial.color.setHex(0x1e90ff); // Синий для CT
        } else {
            pistolMaterial.color.setHex(0xff6b35); // Оранжевый для T
        }
    }
    
    // Отправляем выбор команды на сервер
    if (socket && socket.connected) {
        socket.emit('selectTeam', team);
    }
}

function startGame() {
    // Скрываем меню
    document.getElementById('start-screen').classList.add('hidden');
    document.body.classList.add('locked');
    
    // Захватываем курсор
    renderer.domElement.requestPointerLock();
}

function onPointerLockChange() {
    isLocked = document.pointerLockElement === renderer.domElement;
    
    if (!isLocked) {
        // Если курсор отпущен - показываем меню
        document.getElementById('start-screen').classList.remove('hidden');
        document.body.classList.remove('locked');
    }
}

function onMouseMove(event) {
    if (!isLocked) return;

    // Чувствительность мыши
    const sensitivity = 0.002;

    // Обновляем углы поворота
    yaw -= event.movementX * sensitivity;
    pitch -= event.movementY * sensitivity;

    // Ограничение вертикального поворота (чтобы не перевернуться)
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));

    // Применяем к камере
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
}

function onKeyDown(event) {
    switch (event.code) {
        case 'KeyW':    keys.forward = true; break;
        case 'KeyS':    keys.backward = true; break;
        case 'KeyA':    keys.left = true; break;
        case 'KeyD':    keys.right = true; break;
        case 'Space':   keys.jump = true; break;
        case 'Digit1':  switchWeapon('pistol'); break;
        case 'Digit2':  switchWeapon('knife'); break;
        case 'Digit3':  switchWeapon('ak47'); break;
    }
}

function onKeyUp(event) {
    switch (event.code) {
        case 'KeyW':
            keys.forward = false;
            break;
        case 'KeyS':
            keys.backward = false;
            break;
        case 'KeyA':
            keys.left = false;
            break;
        case 'KeyD':
            keys.right = false;
            break;
        case 'Space':
            keys.jump = false;
            break;
    }
}

// ============================================================================
// СТРЕЛЬБА
// ============================================================================

function onMouseDown(event) {
    if (!isLocked) return;
    if (event.button !== 0) return;
    shoot();
}

function shoot() {
    const now = performance.now() / 1000;
    const cfg = WEAPON_CONFIG[weapons.current];

    // Проверка скорострельности
    if (now - lastShotTime < cfg.fireRate) return;
    lastShotTime = now;

    if (!cfg.isRanged) {
        // --- УДАР НОЖОМ ---
        doKnifeAttack(cfg);
        return;
    }

    // --- ОГНЕСТРЕЛЬНОЕ ОРУЖИЕ ---
    const bulletGeometry = new THREE.SphereGeometry(0.03, 8, 8);
    const bulletColor = weapons.current === 'ak47' ? 0xff4400 : 0xffff00;
    const bulletMaterial = new THREE.MeshBasicMaterial({ color: bulletColor });
    const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);

    const weaponPos = new THREE.Vector3(0.2, -0.12, -0.6);
    weaponPos.applyMatrix4(camera.matrixWorld);
    bullet.position.copy(weaponPos);

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);

    // Разброс зависит от оружия
    direction.x += (Math.random() - 0.5) * (cfg.spread || 0.02);
    direction.y += (Math.random() - 0.5) * (cfg.spread || 0.02);
    direction.normalize();

    bullet.userData = {
        velocity: direction.multiplyScalar(cfg.bulletSpeed || 50),
        lifetime: cfg.bulletLifetime || 2,
        damage: cfg.damage,
        owner: socket ? socket.id : 'local'
    };

    scene.add(bullet);
    bullets.push(bullet);

    // Отправляем на сервер
    if (socket && socket.connected) {
        const bulletPos = new THREE.Vector3();
        bullet.getWorldPosition(bulletPos);
        socket.emit('shoot', {
            position: { x: bulletPos.x, y: bulletPos.y, z: bulletPos.z },
            direction: { x: bullet.userData.velocity.x, y: bullet.userData.velocity.y, z: bullet.userData.velocity.z }
        });
    }

    // Отдача оружия
    if (player.weapon) {
        player.weapon.position.z += cfg.recoil || 0.1;
    }
}

function doKnifeAttack(cfg) {
    // Анимация удара — поворот вперёд, а не смещение по Z
    const model = weapons.models.knife;
    const origRotX = model.rotation.x;
    const origPosY = model.position.y;

    model.rotation.x += 0.8;
    model.position.y  += 0.1;

    setTimeout(() => {
        model.rotation.x = origRotX;
        model.position.y  = origPosY;
    }, 180);

    // Проверяем попадание в ближнем бою
    for (const playerId in otherPlayers) {
        const otherPlayer = otherPlayers[playerId];
        const distance = camera.position.distanceTo(otherPlayer.position);
        if (distance < cfg.meleeRange) {
            // Визуальный эффект
            if (otherPlayer.material) {
                otherPlayer.material.emissive.setHex(0xff0000);
                setTimeout(() => otherPlayer.material.emissive.setHex(0x000000), 150);
            }
            // Урон
            if (otherPlayer.userData.health !== undefined) {
                otherPlayer.userData.health -= cfg.damage;
                if (otherPlayer.userData.health < 0) otherPlayer.userData.health = 0;
                if (otherPlayer.userData.hpBar) {
                    otherPlayer.userData.hpBar.scale.x = otherPlayer.userData.health / 100;
                    const h = otherPlayer.userData.health;
                    otherPlayer.userData.hpBar.material.color.setHex(h > 60 ? 0x00ff00 : h > 30 ? 0xffff00 : 0xff0000);
                }
            }
            if (socket && socket.connected) {
                socket.emit('playerHit', { targetId: playerId, damage: cfg.damage });
            }
        }
    }
}

function updateBullets(deltaTime) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        
        // Обновляем позицию
        bullet.position.add(
            bullet.userData.velocity.clone().multiplyScalar(deltaTime)
        );
        
    // Проверка столкновения с другими игроками
        for (const playerId in otherPlayers) {
            const otherPlayer = otherPlayers[playerId];
            const distance = bullet.position.distanceTo(otherPlayer.position);
            
            if (distance < 1) { // Если пуля попала в игрока
                // Удаляем пулю
                scene.remove(bullet);
                bullets.splice(i, 1);
                
                // Визуальный эффект попадания (мигание игрока)
                otherPlayer.material.emissive.setHex(0xff0000);
                setTimeout(() => {
                    otherPlayer.material.emissive.setHex(0x000000);
                }, 100);
                
                // Обновляем HP другого игрока
                if (otherPlayer.userData.health !== undefined) {
                    otherPlayer.userData.health -= 10;
                    if (otherPlayer.userData.health < 0) otherPlayer.userData.health = 0;
                    
                    // Обновляем HP бар
                    if (otherPlayer.userData.hpBar) {
                        otherPlayer.userData.hpBar.scale.x = otherPlayer.userData.health / 100;
                        // Меняем цвет
                        if (otherPlayer.userData.health > 60) {
                            otherPlayer.userData.hpBar.material.color.setHex(0x00ff00);
                        } else if (otherPlayer.userData.health > 30) {
                            otherPlayer.userData.hpBar.material.color.setHex(0xffff00);
                        } else {
                            otherPlayer.userData.hpBar.material.color.setHex(0xff0000);
                        }
                    }
                    
                    // Если игрок мертв - сообщаем серверу
                    if (otherPlayer.userData.health <= 0) {
                        if (socket && socket.connected) {
                            socket.emit('playerKilled', { victimId: playerId });
                        }
                    }
                }
                
                // Отправляем урон на сервер
                if (socket && socket.connected && bullet.userData.owner === socket.id) {
                    socket.emit('playerHit', {
                        targetId: playerId,
                        damage: bullet.userData.damage || 25
                    });
                }
                
                break;
            }
        }
        
        // Проверка столкновения с локальным игроком
        // (для пуль выпущенных другими игроками)
        if (bullet.userData.owner && bullet.userData.owner !== socket.id) {
            const distanceToLocal = bullet.position.distanceTo(camera.position);
            if (distanceToLocal < 0.5) {
                // Удаляем пулю
                scene.remove(bullet);
                bullets.splice(i, 1);
                
                // Нанесение урона
                takeDamage(10);
                continue;
            }
        }
        
        // Уменьшаем время жизни
        bullet.userData.lifetime -= deltaTime;
        
        // Удаляем если время вышло
        if (bullet.userData.lifetime <= 0 && bullets[i]) {
            scene.remove(bullet);
            bullets.splice(i, 1);
        }
    }
    
    // Возврат оружия после отдачи
    if (player.weapon && WEAPON_TRANSFORM[weapons.current]) {
        const originZ = WEAPON_TRANSFORM[weapons.current].position.z;
        if (player.weapon.position.z > originZ) {
            player.weapon.position.z -= 5 * deltaTime;
            if (player.weapon.position.z < originZ) player.weapon.position.z = originZ;
        }
    }
}

// ============================================================================
// ОБНОВЛЕНИЕ ФИЗИКИ И ДВИЖЕНИЯ
// ============================================================================

function updatePlayer(deltaTime) {
    if (!isLocked) return;

    // Гравитация
    const gravity = 20;
    
    // Создаем вектор направления движения
    player.direction.set(0, 0, 0);

    if (keys.forward) player.direction.z -= 1;
    if (keys.backward) player.direction.z += 1;
    if (keys.left) player.direction.x -= 1;
    if (keys.right) player.direction.x += 1;

    // Нормализуем вектор (чтобы движение по диагонали не было быстрее)
    if (player.direction.length() > 0) {
        player.direction.normalize();
    }

    // Поворачиваем направление относительно камеры
    player.direction.applyEuler(new THREE.Euler(0, camera.rotation.y, 0));

    // Применяем скорость
    player.velocity.x = player.direction.x * player.speed;
    player.velocity.z = player.direction.z * player.speed;

    // Прыжок
    if (keys.jump && player.onGround) {
        player.velocity.y = player.jumpForce;
        player.onGround = false;
    }

    // Гравитация
    player.velocity.y -= gravity * deltaTime;

    // Применяем скорость к позиции
    camera.position.x += player.velocity.x * deltaTime;
    camera.position.y += player.velocity.y * deltaTime;
    camera.position.z += player.velocity.z * deltaTime;

    // Проверка пола (простейшая)
    if (camera.position.y < player.height) {
        camera.position.y = player.height;
        player.velocity.y = 0;
        player.onGround = true;
    }

    // Отправка координат на сервер (с небольшой задержкой для оптимизации)
    if (socket && socket.connected) {
        sendPositionToServer();
    }
}

// Таймер для отправки позиции (чтобы не спамить сервер)
let lastPositionUpdate = 0;
const POSITION_UPDATE_INTERVAL = 50; // мс

function sendPositionToServer() {
    const now = Date.now();
    if (now - lastPositionUpdate < POSITION_UPDATE_INTERVAL) return;
    lastPositionUpdate = now;

    socket.emit('playerMovement', {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        rotationY: camera.rotation.y
    });
}

// ============================================================================
// SOCKET.IO - МУЛЬТИПЛЕЕР
// ============================================================================

function setupSocket() {
    // Подключаемся к серверу
    socket = io();

    // Получаем текущих игроков при подключении
    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach(id => {
            if (id !== socket.id) {
                createOtherPlayer(players[id]);
            }
        });
    });

    // Новый игрок подключился
    socket.on('newPlayer', (playerData) => {
        createOtherPlayer(playerData);
    });

    // Игрок отключился
    socket.on('playerDisconnected', (playerId) => {
        removeOtherPlayer(playerId);
    });

    // Игрок переместился
    socket.on('playerMoved', (playerData) => {
        updateOtherPlayer(playerData);
    });

    // Игрок сменил команду
    socket.on('playerTeamChanged', (playerData) => {
        updateOtherPlayerTeam(playerData);
    });

    // Пуля другого игрока
    socket.on('bulletFired', (data) => {
        createRemoteBullet(data);
    });

    // Игрок был ранен
    socket.on('playerWasHit', (data) => {
        if (data.targetId === socket.id) {
            takeDamage(data.damage);
        }
    });

    // Обновление счетчика игроков
    socket.on('currentPlayers', updatePlayersCount);
    socket.on('newPlayer', updatePlayersCount);
    socket.on('playerDisconnected', updatePlayersCount);

    // Лидерборд
    socket.on('leaderboard', (data) => {
        updateLeaderboard(data);
    });

    // Лента убийств
    socket.on('killFeed', (data) => {
        showKillFeed(data.killerName, data.victimName);
    });
}

function createOtherPlayer(playerData) {
    // Создаем куб/капсулу для отображения другого игрока
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    
    // Цвет в зависимости от команды
    let color = 0x888888; // Серый по умолчанию
    if (playerData.team === 'CT') {
        color = 0x1e90ff; // Синий для CT
    } else if (playerData.team === 'T') {
        color = 0xff6b35; // Оранжевый для T
    }
    
    const material = new THREE.MeshStandardMaterial({ 
        color: color,
        transparent: true,
        opacity: 0.8
    });
    const mesh = new THREE.Mesh(geometry, material);
    
    mesh.position.set(playerData.x, playerData.y, playerData.z);
    mesh.userData.id = playerData.id;
    mesh.userData.team = playerData.team;
    mesh.userData.health = 100; // Здоровье игрока
    
    // Добавляем HP бар над игроком
    const hpBarGeometry = new THREE.PlaneGeometry(1, 0.1);
    const hpBarMaterial = new THREE.MeshBasicMaterial({ 
        color: 0x00ff00,
        side: THREE.DoubleSide
    });
    const hpBar = new THREE.Mesh(hpBarGeometry, hpBarMaterial);
    hpBar.position.y = 1.3;
    mesh.add(hpBar);
    mesh.userData.hpBar = hpBar;
    
    scene.add(mesh);
    otherPlayers[playerData.id] = mesh;
    
    updatePlayersCount();
}

function removeOtherPlayer(playerId) {
    if (otherPlayers[playerId]) {
        scene.remove(otherPlayers[playerId]);
        delete otherPlayers[playerId];
    }
    updatePlayersCount();
}

function updateOtherPlayer(playerData) {
    if (otherPlayers[playerData.id]) {
        const mesh = otherPlayers[playerData.id];
        // Плавное перемещение (можно улучшить с интерполяцией)
        mesh.position.set(playerData.x, playerData.y, playerData.z);
        mesh.rotation.y = playerData.rotationY;
    }
}

function updateOtherPlayerTeam(playerData) {
    if (otherPlayers[playerData.id]) {
        const mesh = otherPlayers[playerData.id];
        mesh.userData.team = playerData.team;
        
        // Обновляем цвет в зависимости от команды
        let color = 0x888888;
        if (playerData.team === 'CT') {
            color = 0x1e90ff;
        } else if (playerData.team === 'T') {
            color = 0xff6b35;
        }
        mesh.material.color.setHex(color);
    }
}

// Создание пули другого игрока
function createRemoteBullet(data) {
    const bulletGeometry = new THREE.SphereGeometry(0.03, 8, 8);
    const bulletMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xff6600 // Оранжевая пуля для врагов
    });
    const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
    
    bullet.position.set(data.position.x, data.position.y, data.position.z);
    
    const velocity = new THREE.Vector3(
        data.direction.x,
        data.direction.y,
        data.direction.z
    ).multiplyScalar(BULLET_SPEED);
    
    bullet.userData = {
        velocity: velocity,
        lifetime: BULLET_LIFETIME,
        owner: data.id
    };
    
    scene.add(bullet);
    bullets.push(bullet);
}

// Обновление HP бара других игроков
function updateOtherPlayersHP() {
    for (const playerId in otherPlayers) {
        const mesh = otherPlayers[playerId];
        if (mesh.userData.hpBar) {
            // Поворачиваем HP бар к камере
            mesh.userData.hpBar.lookAt(camera.position);
        }
    }
}

function updatePlayersCount() {
    const count = Object.keys(otherPlayers).length + 1; // +1 это мы сами
    let teamInfo = '';
    if (player.team) {
        teamInfo = ` [${player.team}]`;
    }
    document.getElementById('players-count').textContent = `Игроков: ${count}${teamInfo}`;
}

// ============================================================================
// HP (ЗДОРОВЬЕ)
// ============================================================================

function updateHealthUI() {
    const healthFill = document.getElementById('health-fill');
    const healthText = document.getElementById('health-text');
    
    healthFill.style.width = `${player.health}%`;
    healthText.textContent = player.health;
    
    // Меняем цвет в зависимости от HP
    if (player.health > 60) {
        healthFill.style.background = 'linear-gradient(90deg, #33ff33, #66ff66)';
    } else if (player.health > 30) {
        healthFill.style.background = 'linear-gradient(90deg, #ffcc00, #ffdd33)';
    } else {
        healthFill.style.background = 'linear-gradient(90deg, #ff3333, #ff5555)';
    }
}

function takeDamage(amount) {
    player.health -= amount;
    if (player.health < 0) player.health = 0;
    
    updateHealthUI();
    
    // Эффект повреждения (покраснение экрана)
    document.getElementById('game-container').style.boxShadow = 'inset 0 0 50px rgba(255, 0, 0, 0.5)';
    setTimeout(() => {
        document.getElementById('game-container').style.boxShadow = 'none';
    }, 200);
    
    // Проверка на смерть
    if (player.health <= 0) {
        respawn();
    }
}

function respawn() {
    // Сброс HP
    player.health = player.maxHealth;
    updateHealthUI();
    
    // Телепортация на стартовую позицию
    camera.position.set(0, player.height, 0);
    
    // Эффект респауна
    document.getElementById('start-screen').classList.remove('hidden');
    document.body.classList.remove('locked');
    document.exitPointerLock();
    
    alert('Вы погибли! Выберите команду и продолжите игру.');
}

// ============================================================================
// FPS СЧЕТЧИК
// ============================================================================

function updateFPS() {
    frameCount++;
    const now = Date.now();
    
    if (now - lastFpsUpdate >= 1000) {
        document.getElementById('fps-counter').textContent = `FPS: ${frameCount}`;
        frameCount = 0;
        lastFpsUpdate = now;
    }
}

// ============================================================================
// ИГРОВОЙ ЦИКЛ
// ============================================================================

function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();

    // Обновляем игрока
    updatePlayer(deltaTime);
    
    // Обновляем пули
    updateBullets(deltaTime);
    
    // Обновляем HP бары других игроков
    updateOtherPlayersHP();

    // Рендерим основную сцену
    renderer.render(scene, camera);

    // Рендерим оружие поверх — очищаем только глубину, не цвет
    // Это гарантирует что оружие всегда поверх стен/объектов
    if (window.weaponScene && window.weaponCamera) {
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(weaponScene, weaponCamera);
        renderer.autoClear = true;
    }

    // Обновляем FPS
    updateFPS();
}

// ============================================================================
// ИЗМЕНЕНИЕ РАЗМЕРА ОКНА
// ============================================================================

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    if (window.weaponCamera) {
        weaponCamera.aspect = window.innerWidth / window.innerHeight;
        weaponCamera.updateProjectionMatrix();
    }
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================================================
// ЛИДЕРБОРД
// ============================================================================

let leaderboardData = [];

function updateLeaderboard(data) {
    leaderboardData = data;
    const tbody = document.getElementById('leaderboard-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    data.forEach((entry, i) => {
        const kd = entry.deaths === 0 ? entry.kills.toFixed(1) : (entry.kills / entry.deaths).toFixed(2);
        const isMe = socket && entry.id === socket.id;
        const tr = document.createElement('tr');
        if (isMe) tr.classList.add('me');

        const medals = ['🥇', '🥈', '🥉'];
        const rank = medals[i] || `<span class="rank-num">${i + 1}</span>`;

        tr.innerHTML = `
            <td>${rank}</td>
            <td>${entry.name}${isMe ? ' <span style="color:#e94560">(Вы)</span>' : ''}</td>
            <td>${entry.kills}</td>
            <td>${entry.deaths}</td>
            <td>${kd}</td>
        `;
        tbody.appendChild(tr);
    });
}

function showKillFeed(killer, victim) {
    const feed = document.getElementById('kill-feed');
    if (!feed) return;

    const el = document.createElement('div');
    el.className = 'kill-entry';
    el.innerHTML = `<span class="killer">${killer}</span><span class="icon">💀</span><span class="victim">${victim}</span>`;
    feed.appendChild(el);

    // Удаляем через 4 секунды
    setTimeout(() => {
        el.style.transition = 'opacity 0.5s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 500);
    }, 4000);

    // Максимум 5 записей
    while (feed.children.length > 5) feed.removeChild(feed.firstChild);
}

// Tab — показать/скрыть лидерборд
document.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') {
        e.preventDefault();
        document.getElementById('leaderboard').classList.remove('hidden');
    }
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'Tab') {
        document.getElementById('leaderboard').classList.add('hidden');
    }
});

// ============================================================================
// ЗАПУСК
// ============================================================================

// Запускаем игру после загрузки страницы
window.addEventListener('load', init);
