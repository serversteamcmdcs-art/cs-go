/**
 * CS:GO 10000000.16 - Руководство по добавлению моделей
 * 
 * Для добавления своих 3D моделей в игру есть несколько способов:
 * 
 * 1. ПРОСТОЙ: Использовать Three.js примитивы (кубы, сферы и т.д.)
 *    - см. функцию createWeapon() в main.js
 * 
 * 2. СЛОЖНЫЙ: Загрузить GLTF/OBJ модель
 *    - Нужно использовать THREE.GLTFLoader или THREE.OBJLoader
 *    - Добавить их в HTML: <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
 * 
 * ============================================
 * ПРИМЕР: Загрузка GLTF модели
 * ============================================
 * 
 * // Добавить в HTML перед main.js:
 * <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
 * 
 * // В main.js добавить функцию:
 * function loadCustomModel(url, position, scale) {
 *     const loader = new THREE.GLTFLoader();
 *     
 *     loader.load(url, function(gltf) {
 *         const model = gltf.scene;
 *         model.position.set(position.x, position.y, position.z);
 *         model.scale.set(scale, scale, scale);
 *         scene.add(model);
 *     }, undefined, function(error) {
 *         console.error('Ошибка загрузки модели:', error);
 *     });
 * }
 * 
 * // Использование:
 * loadCustomModel('models/ak47.glb', {x: 0, y: -0.15, z: -0.5}, 0.5);
 * 
 * ============================================
 * ПРИМЕР: Замена пистолета на свою модель
 * ============================================
 * 
 * // Создайте свою модель оружия\nfunction createCustomWeapon() {\n    const weaponGroup = new THREE.Group();\n    \n    // Загрузите модель или создайте из примитивов\n    // ... ваш код ...\n    \n    // Пример: загрузка из файла\n    const loader = new THREE.GLTFLoader();\n    loader.load('./models/my_weapon.glb', (gltf) => {\n        const weapon = gltf.scene;\n        weapon.scale.set(0.5, 0.5, 0.5);\n        weapon.position.set(0.2, -0.15, -0.4);\n        weaponGroup.add(weapon);\n    });\n    \n    return weaponGroup;\n}\n * 
 * // Затем в init() замените:\n * player.weapon = createCustomWeapon();
 * 
 * ============================================
 * ГДЕ ВЗЯТЬ МОДЕЛИ БЕСПЛАТНО:\n * ============================================
 * - Sketchfab (бесплатные модели)\n * - TF3DM\n * - Sketchup 3D Warehouse\n * - OpenGameArt.org\n * 
 * Форматы: .glb (рекомендуется), .gltf, .obj\n * 
 * ВАЖНО: Модели должны быть в папке public/\n * Пример: public/models/ak47.glb\n */
