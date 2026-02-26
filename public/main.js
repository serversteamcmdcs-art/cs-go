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

// Модель локального игрока (своё тело — видно от 3го лица, камера в голове)
let localPlayerModel = null;

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

// Глобальное определение типа устройства (установлено в index.html до загрузки скрипта)
const isMobile = window.IS_MOBILE || false;

function init() {
    const isMobile = window.IS_MOBILE || false;

    // Создаем Three.js сцену
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, isMobile ? 8 : 10, isMobile ? 40 : 100);

    // Создаем камеру
    camera = new THREE.PerspectiveCamera(
        isMobile ? 90 : 75,           // Шире FOV на мобильном
        window.innerWidth / window.innerHeight,
        0.1,
        isMobile ? 200 : 1000
    );
    camera.position.set(0, player.height, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(0, 0, 0); // смотрит прямо вперёд
    yaw   = 0;
    pitch = 0;

    // Создаем рендерер
    renderer = new THREE.WebGLRenderer({
        antialias: !isMobile,          // Антиалиасинг только на ПК
        powerPreference: isMobile ? 'low-power' : 'high-performance'
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    // На мобильном снижаем разрешение рендера (сильно экономит батарею и GPU)
    renderer.setPixelRatio(isMobile ? Math.min(window.devicePixelRatio, 1.5) : window.devicePixelRatio);
    renderer.shadowMap.enabled = !isMobile;   // Тени только на ПК
    if (!isMobile) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('game-container').appendChild(renderer.domElement);

    // Таймер
    clock = new THREE.Clock();

    // Настраиваем освещение
    setupLighting();

    // Создаем оружие
    setupWeapon();

    // Модель локального игрока (тело)
    setupLocalPlayerModel();

    // Создаем игровой мир
    createWorld();

    // Настраиваем управление
    setupControls();

    // Мобильное управление
    setupMobileControls();

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
    pistol: { damage: 25, fireRate: 0.4, isRanged: true, bulletSpeed: 50, bulletLifetime: 2, recoil: 0.1, slot: 2 },
    knife:  { damage: 80, fireRate: 0.8, isRanged: false, meleeRange: 2.5, slot: 3 },
    ak47:   { damage: 35, fireRate: 0.1, isRanged: true, bulletSpeed: 80, bulletLifetime: 1.5, recoil: 0.15, slot: 1 }
};

let lastShotTime = 0;

// Материалы для оружий — используем встроенные из GLB (там уже есть текстуры)
// Если нужно переопределить цвет — можно добавить сюда

// Настройки позиций/поворотов оружий — после авто-нормализации
const WEAPON_TRANSFORM = {
    pistol: {
        position: new THREE.Vector3(0.15, -0.16, -0.30),
        rotation: new THREE.Euler(0, Math.PI, 0),
        targetSize: 0.28,
        hand: { x: 0.14, y: -0.22, z: -0.18, rx: 0.1, rz: 0.0 }
    },
    knife: {
        position: new THREE.Vector3(0.15, -0.06, -0.30),
        rotation: new THREE.Euler(Math.PI / 2, Math.PI, 0),
        targetSize: 0.28,
        hand: { x: 0.14, y: -0.12, z: -0.20, rx: 0.1, rz: 0.0 }
    },
    ak47: {
        position: new THREE.Vector3(0.22, -0.06, -0.2),
        rotation: new THREE.Euler(0, 2, 0),
        targetSize: 0.30,
        hand: { x: 0.14, y: -0.12, z: -0.20, rx: 0.1, rz: 0.0 }
    }
};

function setupWeapon() {
    const loader = new THREE.GLTFLoader();
    let loadedCount = 0;
    const total = 3;

    window.weaponScene = new THREE.Scene();
    weaponScene.add(new THREE.AmbientLight(0xffffff, 0.8));

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(0.5, 1, 1);
    weaponScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffddbb, 0.5);
    fillLight.position.set(-1, 0, 0.5);
    weaponScene.add(fillLight);

    window.weaponCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 10);

    // Рука
    window.weaponHand = createHandModel();
    weaponScene.add(weaponHand);

    function onLoaded(name, gltf) {
        const cfg = WEAPON_TRANSFORM[name];
        const model = gltf.scene;

        // Нормализуем размер по targetSize
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) model.scale.setScalar(cfg.targetSize / maxDim);

        // Центрируем геометрию
        const box2 = new THREE.Box3().setFromObject(model);
        const center = new THREE.Vector3();
        box2.getCenter(center);
        model.position.sub(center);

        // Применяем позицию и поворот из конфига
        model.position.add(cfg.position);
        model.rotation.copy(cfg.rotation);
        model.visible = false;
        model.traverse(child => { if (child.isMesh) child.frustumCulled = false; });

        weapons.models[name] = model;
        weaponScene.add(model);

        loadedCount++;
        if (loadedCount === total) {
            scene.add(camera);
            weapons.models[weapons.current].visible = true;
            player.weapon = weapons.models[weapons.current];
            positionHand(weapons.current);
            updateWeaponHUD();
        }
    }

    function onError(name, color) {
        return (err) => {
            console.error('Ошибка загрузки ' + name + ':', err);
            const grp = new THREE.Group();
            grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.28), new THREE.MeshLambertMaterial({ color })));
            onLoaded(name, { scene: grp });
        };
    }

    loader.load('models/pistol.glb', gltf => onLoaded('pistol', gltf), undefined, onError('pistol.glb', 0x555555));
    loader.load('models/knife.glb',  gltf => onLoaded('knife',  gltf), undefined, onError('knife.glb',  0xc0c0c0));
    loader.load('models/ak-47.glb',  gltf => onLoaded('ak47',   gltf), undefined, onError('ak-47.glb',  0x333333));
}

// Позиционируем руку под текущее оружие
function positionHand(name) {
    if (!window.weaponHand) return;
    const h = WEAPON_TRANSFORM[name].hand;
    weaponHand.position.set(h.x, h.y, h.z);
    weaponHand.rotation.set(h.rx, 0, h.rz);
    weaponHand.visible = true;
}

// 3D модель руки
function createHandModel() {
    const g = new THREE.Group();
    const skin   = new THREE.MeshLambertMaterial({ color: 0xd4956a });
    const sleeve = new THREE.MeshLambertMaterial({ color: 0x222222 });

    // Рукав
    const slv = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.20, 10), sleeve);
    slv.rotation.x = Math.PI / 2; slv.position.set(0, 0, 0.10); g.add(slv);

    // Запястье
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.034, 0.07, 10), skin);
    wrist.rotation.x = Math.PI / 2; wrist.position.set(0, 0, -0.02); g.add(wrist);

    // Ладонь
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.028, 0.095), skin);
    palm.position.set(0, 0, -0.095); g.add(palm);

    // 4 пальца
    for (let i = 0; i < 4; i++) {
        const px = -0.026 + i * 0.018;
        const f1 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.055, 6), skin);
        f1.rotation.x = Math.PI / 2; f1.position.set(px, 0.016, -0.155); g.add(f1);
        const f2 = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.008, 0.040, 6), skin);
        f2.rotation.x = Math.PI / 2; f2.position.set(px, 0.016, -0.198); g.add(f2);
    }

    // Большой палец
    const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.011, 0.048, 6), skin);
    thumb.rotation.z = Math.PI / 4; thumb.rotation.x = 0.3;
    thumb.position.set(0.042, 0.012, -0.105); g.add(thumb);

    return g;
}

function createFallbackModel(color) {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.28), new THREE.MeshLambertMaterial({ color })));
    return grp;
}

function switchWeapon(weaponName) {
    if (weapons.current === weaponName || !weapons.models[weaponName]) return;

    weapons.models[weapons.current].visible = false;
    weapons.current = weaponName;
    weapons.models[weaponName].visible = true;
    player.weapon = weapons.models[weaponName];
    positionHand(weaponName);
    updateWeaponHUD();

    // Анимация появления снизу
    const model = weapons.models[weaponName];
    const cfg = WEAPON_TRANSFORM[weaponName];
    const origY = cfg.position.y;
    model.position.y = origY - 0.35;
    const startTime = Date.now();
    (function animateIn() {
        const t = Math.min((Date.now() - startTime) / 150, 1);
        model.position.y = origY - 0.35 + t * 0.35;
        if (window.weaponHand) weaponHand.position.y = (origY - 0.065) - 0.35 + t * 0.35;
        if (t < 1) requestAnimationFrame(animateIn);
        else { model.position.y = origY; positionHand(weaponName); }
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
    // Кнопка ИГРАТЬ
    document.getElementById('start-btn').addEventListener('click', startGame);

    // Выбор команды
    document.getElementById('btn-ct').addEventListener('click', () => selectTeam('CT'));
    document.getElementById('btn-t').addEventListener('click',  () => selectTeam('T'));

    // Pointer Lock
    document.addEventListener('pointerlockchange',    onPointerLockChange);
    document.addEventListener('mozpointerlockchange', onPointerLockChange);

    // Клик по canvas — перезахватить мышь если вышли из pointerlock (нажали Esc)
    renderer.domElement.addEventListener('click', () => {
        if (!isMobile && !document.pointerLockElement) {
            renderer.domElement.requestPointerLock();
        }
    });

    // Мышь, клавиши, стрельба
    document.addEventListener('mousemove',  onMouseMove);
    document.addEventListener('keydown',    onKeyDown);
    document.addEventListener('keyup',      onKeyUp);
    document.addEventListener('mousedown',  onMouseDown);
    document.addEventListener('mouseup',    onMouseUp);
}

function selectTeam(team) {
    player.team = team;

    document.getElementById('btn-ct').classList.remove('selected');
    document.getElementById('btn-t').classList.remove('selected');

    if (team === 'CT') {
        document.getElementById('btn-ct').classList.add('selected');
    } else {
        document.getElementById('btn-t').classList.add('selected');
    }

    document.getElementById('start-btn').disabled = false;

    if (socket && socket.connected) {
        socket.emit('selectTeam', team);
    }
}

function startGame() {
    document.getElementById('start-screen').classList.add('hidden');
    document.body.classList.add('locked');

    if (isMobile) {
        isLocked = true;
    } else {
        renderer.domElement.requestPointerLock();
    }
}

function onPointerLockChange() {
    if (document.pointerLockElement === renderer.domElement) {
        // Мышь захвачена
        isLocked = true;
    } else {
        // Мышь отпущена (Esc)
        isLocked = false;
        document.getElementById('start-screen').classList.remove('hidden');
        document.body.classList.remove('locked');
    }
}

function onMouseMove(event) {
    if (!isLocked) return;
    if (!isMobile && !document.pointerLockElement) return;

    const dx = event.movementX || 0;
    const dy = event.movementY || 0;

    yaw   -= dx * 0.002;
    pitch -= dy * 0.002;
    pitch  = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));

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

let isFiring = false;
let fireInterval = null;

function startFiring() {
    if (isFiring) return;
    isFiring = true;
    shoot(); // Первый выстрел сразу
    // Интервал по скорострельности текущего оружия
    const rate = WEAPON_CONFIG[weapons.current].fireRate * 1000;
    fireInterval = setInterval(() => { if (isFiring) shoot(); }, rate);
}

function stopFiring() {
    isFiring = false;
    if (fireInterval) { clearInterval(fireInterval); fireInterval = null; }
}

// При смене оружия — перезапускаем интервал с новой скорострельностью
const _origSwitchWeapon = switchWeapon;
function switchWeaponWithFireRestart(name) {
    const wasFiring = isFiring;
    if (wasFiring) stopFiring();
    _origSwitchWeapon(name);
    if (wasFiring) startFiring();
}

function onMouseDown(event) {
    if (!isLocked) return;
    if (event.button !== 0) return;
    startFiring();
}

function onMouseUp(event) {
    if (event.button !== 0) return;
    stopFiring();
}

// Останавливаем стрельбу если потеряли фокус или вышли из pointer lock
document.addEventListener('visibilitychange', () => { if (document.hidden) stopFiring(); });
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) stopFiring(); });

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
            // Визуальный эффект вспышки при попадании
            if (otherPlayer.userData.model) {
                otherPlayer.userData.model.traverse(child => {
                    if (child.isMesh && child.material && child.material.emissive) {
                        child.material.emissive.setHex(0xff0000);
                        setTimeout(() => child.material.emissive.setHex(0x000000), 150);
                    }
                });
            }
            // Урон
            if (otherPlayer.userData.health !== undefined) {
                otherPlayer.userData.health -= cfg.damage;
                if (otherPlayer.userData.health < 0) otherPlayer.userData.health = 0;
                updateHpBarValue(otherPlayer, otherPlayer.userData.health / 100);
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
                
                // Визуальный эффект попадания
                if (otherPlayer.userData.model) {
                    otherPlayer.userData.model.traverse(child => {
                        if (child.isMesh && child.material && child.material.emissive) {
                            child.material.emissive.setHex(0xff0000);
                            setTimeout(() => child.material.emissive.setHex(0x000000), 100);
                        }
                    });
                }
                
                // Обновляем HP другого игрока
                if (otherPlayer.userData.health !== undefined) {
                    otherPlayer.userData.health -= bullet.userData.damage || 25;
                    if (otherPlayer.userData.health < 0) otherPlayer.userData.health = 0;

                    updateHpBarValue(otherPlayer, otherPlayer.userData.health / 100);

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
            if (window.weaponHand) weaponHand.position.z = player.weapon.position.z + 0.04;
            if (player.weapon.position.z < originZ) {
                player.weapon.position.z = originZ;
                positionHand(weapons.current);
            }
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

    // Синхронизируем тело игрока с позицией камеры
    if (localPlayerModel) {
        localPlayerModel.position.set(
            camera.position.x,
            camera.position.y - player.height, // ставим ноги на пол
            camera.position.z
        );
        // Тело поворачивается только по Y (горизонталь), не по X
        localPlayerModel.rotation.y = camera.rotation.y + Math.PI; // +180° — смотрит вперёд
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

// Кешированная GLB-модель игрока (загружается один раз)
// ============================================================================
// МОДЕЛЬ ЛОКАЛЬНОГО ИГРОКА
// ============================================================================

function setupLocalPlayerModel() {
    loadPlayerModel((model) => {
        localPlayerModel = model;

        // Масштаб — побольше, реалистичный рост
        localPlayerModel.scale.setScalar(1.0);

        // Скрываем голову чтобы не мешала обзору от 1го лица
        // (ищем самый верхний меш — обычно это голова)
        let maxY = -Infinity;
        let headMesh = null;
        localPlayerModel.traverse(child => {
            if (child.isMesh) {
                const box = new THREE.Box3().setFromObject(child);
                if (box.max.y > maxY) {
                    maxY = box.max.y;
                    headMesh = child;
                }
            }
        });
        // Скрываем голову — иначе она будет перед камерой
        if (headMesh) headMesh.visible = false;

        localPlayerModel.visible = true;
        scene.add(localPlayerModel);
    });
}



let playerModelTemplate = null;
let playerModelLoading = false;
const playerModelCallbacks = [];

function loadPlayerModel(callback) {
    if (playerModelTemplate) { callback(playerModelTemplate.clone()); return; }
    playerModelCallbacks.push(callback);
    if (playerModelLoading) return;
    playerModelLoading = true;

    // Используем FBXLoader для player.fbx
    if (typeof THREE.FBXLoader !== 'undefined') {
        const loader = new THREE.FBXLoader();
        loader.load('models/player.fbx',
            (fbx) => {
                // Нормализуем масштаб FBX (обычно очень большие)
                const box = new THREE.Box3().setFromObject(fbx);
                const size = new THREE.Vector3();
                box.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                const targetHeight = 1.8;
                const scale = targetHeight / maxDim;
                fbx.scale.setScalar(scale);

                // Центрируем по Y
                const box2 = new THREE.Box3().setFromObject(fbx);
                fbx.position.y -= box2.min.y;

                fbx.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.frustumCulled = true;
                        // Упрощаем материал для производительности
                        if (child.material) {
                            child.material = Array.isArray(child.material)
                                ? child.material.map(m => simplifyMaterial(m))
                                : simplifyMaterial(child.material);
                        }
                    }
                });

                playerModelTemplate = fbx;
                playerModelCallbacks.forEach(cb => cb(playerModelTemplate.clone()));
                playerModelCallbacks.length = 0;
            },
            undefined,
            (err) => {
                console.warn('FBX загрузка не удалась, используем процедурную модель:', err);
                playerModelTemplate = createHumanoidModel();
                playerModelCallbacks.forEach(cb => cb(playerModelTemplate.clone()));
                playerModelCallbacks.length = 0;
            }
        );
    } else {
        // FBXLoader не доступен — резервная модель
        playerModelTemplate = createHumanoidModel();
        playerModelCallbacks.forEach(cb => cb(playerModelTemplate.clone()));
        playerModelCallbacks.length = 0;
    }
}

function simplifyMaterial(mat) {
    // Конвертируем в MeshLambertMaterial для скорости
    const simple = new THREE.MeshLambertMaterial({
        color: mat.color || new THREE.Color(0x888888),
        map: mat.map || null,
        transparent: mat.transparent || false,
        opacity: mat.opacity !== undefined ? mat.opacity : 1.0
    });
    return simple;
}

function createHumanoidModel() {
    const group = new THREE.Group();

    const skinMat  = new THREE.MeshLambertMaterial({ color: 0xf0c080 });
    const bodyMat  = new THREE.MeshLambertMaterial({ color: 0x334466 });
    const legMat   = new THREE.MeshLambertMaterial({ color: 0x222244 });
    const bootMat  = new THREE.MeshLambertMaterial({ color: 0x111111 });

    // Тело
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.25), bodyMat);
    torso.position.y = 0.9;
    group.add(torso);

    // Голова
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.3), skinMat);
    head.position.y = 1.42;
    group.add(head);

    // Шея
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8), skinMat);
    neck.position.y = 1.25;
    group.add(neck);

    // Левая рука
    const lArm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.15), bodyMat);
    lArm.position.set(-0.35, 0.87, 0);
    group.add(lArm);

    // Правая рука
    const rArm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.15), bodyMat);
    rArm.position.set(0.35, 0.87, 0);
    group.add(rArm);

    // Левая нога
    const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.2), legMat);
    lLeg.position.set(-0.13, 0.28, 0);
    group.add(lLeg);

    // Правая нога
    const rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.2), legMat);
    rLeg.position.set(0.13, 0.28, 0);
    group.add(rLeg);

    // Ботинки
    const lBoot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.28), bootMat);
    lBoot.position.set(-0.13, 0.06, 0.04);
    group.add(lBoot);

    const rBoot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.28), bootMat);
    rBoot.position.set(0.13, 0.06, 0.04);
    group.add(rBoot);

    return group;
}

function createHpBar() {
    const group = new THREE.Group();

    // Фон бара
    const bg = new THREE.Mesh(
        new THREE.PlaneGeometry(1.0, 0.12),
        new THREE.MeshBasicMaterial({ color: 0x222222, side: THREE.DoubleSide, depthTest: false })
    );
    group.add(bg);

    // Заливка HP — pivot слева: сдвигаем геометрию чтобы расти вправо
    const fillGeo = new THREE.PlaneGeometry(1.0, 0.10);
    fillGeo.translate(0.5, 0, 0); // pivot левый край
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide, depthTest: false });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.x = -0.5; // выравниваем по левому краю фона
    fill.position.z = 0.005;
    group.add(fill);

    group.userData.fill = fill;
    group.userData.fillMat = fillMat;
    return group;
}

function updateHpBarValue(container, healthPct) {
    const bar = container.userData.hpBarGroup;
    if (!bar) return;
    const fill = bar.userData.fill;
    fill.scale.x = Math.max(0, healthPct);
    const mat = bar.userData.fillMat;
    if (healthPct > 0.6)      mat.color.setHex(0x00e676);
    else if (healthPct > 0.3) mat.color.setHex(0xffca28);
    else                       mat.color.setHex(0xff1744);
}

function createOtherPlayer(playerData) {
    const container = new THREE.Group();
    container.position.set(playerData.x, playerData.y - player.height, playerData.z);
    container.userData.id     = playerData.id;
    container.userData.team   = playerData.team;
    container.userData.health = 100;

    // HP-бар над головой
    const hpBarGroup = createHpBar();
    hpBarGroup.position.y = 2.2; // чуть выше головы (модель 1.8 высотой)
    container.add(hpBarGroup);
    container.userData.hpBarGroup = hpBarGroup;

    // Обратная совместимость — старый код ищет userData.hpBar
    container.userData.hpBar = {
        scale: { x: 1 },
        material: { color: { setHex: () => {} } }
    };

    scene.add(container);
    otherPlayers[playerData.id] = container;

    // Загружаем модель
    loadPlayerModel((model) => {
        const teamColor = playerData.team === 'CT' ? 0x1e90ff
                        : playerData.team === 'T'  ? 0xff6b35
                        : 0x888888;

        model.traverse(child => {
            if (child.isMesh) {
                if (child.material && child.material.color) {
                    child.material = child.material.clone();
                    child.material.emissive = new THREE.Color(teamColor).multiplyScalar(0.15);
                }
                child.frustumCulled = true;
                child.castShadow = true;
            }
        });

        model.scale.setScalar(1.0);
        container.add(model);
        container.userData.model = model;
    });

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
    const container = otherPlayers[playerData.id];
    if (!container) return;
    container.position.set(playerData.x, playerData.y - player.height, playerData.z);
    container.rotation.y = playerData.rotationY;
}

function updateOtherPlayerTeam(playerData) {
    const container = otherPlayers[playerData.id];
    if (!container) return;
    container.userData.team = playerData.team;
    const teamColor = playerData.team === 'CT' ? 0x1e90ff
                    : playerData.team === 'T'  ? 0xff6b35
                    : 0x888888;
    if (container.userData.model) {
        container.userData.model.traverse(child => {
            if (child.isMesh && child.material && child.material.emissive) {
                child.material.emissive = new THREE.Color(teamColor).multiplyScalar(0.15);
            }
        });
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
        const container = otherPlayers[playerId];
        // Поворачиваем HP бар к камере (billboard эффект)
        if (container.userData.hpBarGroup) {
            container.userData.hpBarGroup.lookAt(camera.position);
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
    player.health = player.maxHealth;
    updateHealthUI();
    camera.position.set(0, player.height, 0);
    player.velocity.set(0, 0, 0);

    document.exitPointerLock(); // onPointerLockChange сам поставит isLocked=false и покажет меню
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
// МОБИЛЬНОЕ УПРАВЛЕНИЕ
// ============================================================================

function setupMobileControls() {
    if (!window.IS_MOBILE) return; // Только для мобильных

    // ── Джойстик движения ──────────────────────────────────────────────────
    const joystickZone  = document.getElementById('joystick-zone');
    const joystickBase  = document.getElementById('joystick-base');
    const joystickStick = document.getElementById('joystick-stick');

    const joystick = { active: false, touchId: null, originX: 0, originY: 0, dx: 0, dy: 0, maxRadius: 45 };

    joystickZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (joystick.active) return;
        const touch = e.changedTouches[0];
        joystick.active = true;
        joystick.touchId = touch.identifier;
        const rect = joystickBase.getBoundingClientRect();
        joystick.originX = rect.left + rect.width  / 2;
        joystick.originY = rect.top  + rect.height / 2;
    }, { passive: false });

    joystickZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (touch.identifier !== joystick.touchId) continue;
            let dx = touch.clientX - joystick.originX;
            let dy = touch.clientY - joystick.originY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > joystick.maxRadius) { dx = dx / dist * joystick.maxRadius; dy = dy / dist * joystick.maxRadius; }
            joystick.dx = dx; joystick.dy = dy;
            joystickStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            const t = 12;
            keys.forward  = dy < -t;
            keys.backward = dy >  t;
            keys.left     = dx < -t;
            keys.right    = dx >  t;
        }
    }, { passive: false });

    const joystickEnd = (e) => {
        for (const touch of e.changedTouches) {
            if (touch.identifier !== joystick.touchId) continue;
            joystick.active = false; joystick.touchId = null; joystick.dx = 0; joystick.dy = 0;
            joystickStick.style.transform = 'translate(-50%, -50%)';
            keys.forward = keys.backward = keys.left = keys.right = false;
        }
    };
    joystickZone.addEventListener('touchend',    joystickEnd, { passive: false });
    joystickZone.addEventListener('touchcancel', joystickEnd, { passive: false });

    // ── Зона поворота камеры ───────────────────────────────────────────────
    const lookZone = document.getElementById('look-zone');
    const lookState = { active: false, touchId: null, lastX: 0, lastY: 0 };
    const lookSensitivity = 0.004;

    lookZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (lookState.active) return;
        const touch = e.changedTouches[0];
        lookState.active = true; lookState.touchId = touch.identifier;
        lookState.lastX = touch.clientX; lookState.lastY = touch.clientY;
    }, { passive: false });

    lookZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (touch.identifier !== lookState.touchId) continue;
            const dx = touch.clientX - lookState.lastX;
            const dy = touch.clientY - lookState.lastY;
            lookState.lastX = touch.clientX; lookState.lastY = touch.clientY;
            yaw   -= dx * lookSensitivity;
            pitch -= dy * lookSensitivity;
            pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
            camera.rotation.order = 'YXZ';
            camera.rotation.y = yaw;
            camera.rotation.x = pitch;
        }
    }, { passive: false });

    const lookEnd = (e) => {
        for (const touch of e.changedTouches) {
            if (touch.identifier !== lookState.touchId) continue;
            lookState.active = false; lookState.touchId = null;
        }
    };
    lookZone.addEventListener('touchend',    lookEnd, { passive: false });
    lookZone.addEventListener('touchcancel', lookEnd, { passive: false });

    // ── Кнопка стрельбы (автоогонь при зажатии) ───────────────────────────
    const btnShoot = document.getElementById('btn-shoot');
    let shootInterval = null;

    btnShoot.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isLocked = true;
        startFiring();
    }, { passive: false });

    const stopShootingTouch = (e) => {
        e.preventDefault();
        stopFiring();
    };
    btnShoot.addEventListener('touchend',    stopShootingTouch, { passive: false });
    btnShoot.addEventListener('touchcancel', stopShootingTouch, { passive: false });

    // ── Кнопка прыжка ─────────────────────────────────────────────────────
    const btnJump = document.getElementById('btn-jump');
    btnJump.addEventListener('touchstart',  (e) => { e.preventDefault(); keys.jump = true;  }, { passive: false });
    btnJump.addEventListener('touchend',    (e) => { e.preventDefault(); keys.jump = false; }, { passive: false });
    btnJump.addEventListener('touchcancel', (e) => { e.preventDefault(); keys.jump = false; }, { passive: false });

    // ── Кнопки смены оружия ────────────────────────────────────────────────
    document.querySelectorAll('.weapon-switch-btn').forEach(btn => {
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            switchWeapon(btn.dataset.weapon);
        }, { passive: false });
    });

    // ── Кнопка лидерборда ─────────────────────────────────────────────────
    const btnLeaderboard = document.getElementById('btn-leaderboard');
    if (btnLeaderboard) {
        btnLeaderboard.addEventListener('touchstart', (e) => {
            e.preventDefault();
            document.getElementById('leaderboard').classList.remove('hidden');
        }, { passive: false });
        btnLeaderboard.addEventListener('touchend', (e) => {
            e.preventDefault();
            document.getElementById('leaderboard').classList.add('hidden');
        }, { passive: false });
    }
}



// Запускаем игру после загрузки страницы
window.addEventListener('load', init);
