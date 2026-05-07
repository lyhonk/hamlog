<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import { BarChart3, CalendarDays, Database, FileText, KeyRound, Laptop, ListChecks, LogOut, Radio, Settings, SlidersHorizontal, TrendingUp, Upload, UserCog, UserRound, Wifi } from 'lucide-vue-next';
import { api, clearToken, login, type Antenna, type CarouselSlide, type Contact, type ContactPayload, type DashboardSummary, type Device, type ManagedUser, type UploadPreviewContact, type User } from './api';
import repeaterHero from './assets/tengzhou-repeater-hero.png';
import repeaterSunrise from './assets/tengzhou-repeater-sunrise.png';
import repeaterShack from './assets/tengzhou-repeater-shack.png';
import repeaterDrill from './assets/tengzhou-repeater-drill.png';
import StatCard from './components/StatCard.vue';
import RankPanel from './components/RankPanel.vue';
import LineChart from './components/charts/LineChart.vue';

const navItems = [
  { key: 'dashboard', label: '首页', icon: Radio },
  { key: 'contacts', label: '通联日志', icon: Database },
  { key: 'analytics', label: '统计分析', icon: BarChart3 },
  { key: 'devices', label: '设备管理', icon: Laptop }
] as const;
const publicNavKeys = new Set(['dashboard', 'contacts', 'analytics']);

const carouselSlides = [
  {
    title: '滕州业余无线电中继台',
    eyebrow: 'Repeater Station',
    text: '守候本地频率，连接城市里的每一次清晰通联。',
    image: repeaterHero
  },
  {
    title: '滕州业余无线电中继台',
    eyebrow: 'Morning Watch',
    text: '城市晨光里的本地守听与中继覆盖。',
    image: repeaterSunrise
  },
  {
    title: '滕州业余无线电中继台',
    eyebrow: 'Local Net',
    text: '面向日常值守、应急通信和爱好者交流的通联枢纽。',
    image: repeaterShack
  },
  {
    title: '滕州业余无线电中继台',
    eyebrow: 'On Air',
    text: '记录设备、日志和传播状态，让每一次呼叫都有迹可循。',
    image: repeaterDrill
  }
];

const fallbackCarouselSlides = carouselSlides;

const activeNav = ref('dashboard');
const activeSlide = ref(0);
const userMenuOpen = ref(false);
const activeDialog = ref<'login' | 'profile' | 'password' | 'upload' | null>(null);
const user = ref<User | null>(null);
const loginForm = reactive({ callsign: '', password: '' });
const profileForm = reactive({
  displayName: '',
  nickname: '',
  avatarUrl: '',
  email: '',
  bio: '',
  signature: ''
});
const avatarCrop = reactive({
  source: '',
  zoom: 1,
  offsetX: 0,
  offsetY: 0
});
const avatarCropImage = ref<HTMLImageElement | null>(null);
let avatarCropper: Cropper | null = null;
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });
const uploadForm = reactive({ fileName: '', content: '' });
const carouselUploadForm = reactive({
  title: '',
  subtitle: '',
  imageUrl: '',
  sortOrder: 0
});
const createUserForm = reactive<{ callsign: string; displayName: string; password: string; role: 'admin' | 'operator' }>({
  callsign: '',
  displayName: '',
  password: '',
  role: 'operator'
});
const uploadPreviewRows = ref<UploadPreviewContact[]>([]);
const selectedContacts = ref<Contact[]>([]);
const batchDeleteMode = ref(false);
const editingContactId = ref<number | null>(null);
type EditableContactField = 'contactedAt' | 'callsign' | 'frequencyMhz' | 'mode' | 'deviceId' | 'antennaId' | 'location' | 'powerText' | 'signalReport' | 'note';
const editingField = ref<EditableContactField | null>(null);
const editingCell = reactive<{ id: number | null; field: EditableContactField | null }>({ id: null, field: null });
const editableContactFields: Record<EditableContactField, { label: string; input: 'text' | 'number' | 'select-device' | 'select-antenna' | 'textarea' }> = {
  contactedAt: { label: '通联时间', input: 'text' },
  callsign: { label: '呼号', input: 'text' },
  frequencyMhz: { label: '频率 MHz', input: 'number' },
  mode: { label: '模式', input: 'text' },
  deviceId: { label: '设备', input: 'select-device' },
  antennaId: { label: '天线', input: 'select-antenna' },
  location: { label: '位置', input: 'text' },
  powerText: { label: '功率', input: 'text' },
  signalReport: { label: '信号', input: 'text' },
  note: { label: '备注', input: 'textarea' }
};
const editContactForm = reactive<ContactPayload>({
  contactedAt: '',
  callsign: '',
  frequencyMhz: 0,
  band: '',
  mode: '',
  deviceId: '',
  antennaId: '',
  location: '',
  country: 'China',
  powerW: 0,
  powerText: '',
  signalReport: '',
  note: '',
  operatorCallsign: ''
});
const dialogMessage = ref('');
const dialogError = ref('');
const loginError = ref('');
const loading = ref(true);
const dashboard = ref<DashboardSummary | null>(null);
const devices = ref<Device[]>([]);
const antennas = ref<Antenna[]>([]);
const users = ref<ManagedUser[]>([]);
const carouselItems = ref<CarouselSlide[]>([]);
const contacts = ref<Contact[]>([]);
const pageSizeByView = reactive({
  dashboard: 5,
  contacts: 30
});
const contactsState = reactive({
  page: 1,
  pageSize: pageSizeByView.dashboard,
  pages: 1,
  total: 0,
  callsign: '',
  contactDate: '',
  deviceId: '',
  antennaId: ''
});
const error = ref('');

const roleLabel = computed(() => user.value?.role === 'admin' ? '管理员' : '操作员');
const visibleNavItems = computed(() => user.value ? navItems : navItems.filter((item) => publicNavKeys.has(item.key)));
const canManageContacts = computed(() => user.value?.role === 'admin' || user.value?.role === 'operator');
const isAdmin = computed(() => user.value?.role === 'admin');
const displayCarouselSlides = computed(() => carouselItems.value.length
  ? carouselItems.value.map((slide) => ({
    title: slide.title,
    eyebrow: 'Repeater Station',
    text: slide.subtitle,
    image: slide.imageUrl
  }))
  : fallbackCarouselSlides);
const dialogVisible = computed({
  get: () => activeDialog.value !== null,
  set: (value: boolean) => {
    if (!value) activeDialog.value = null;
  }
});
const dialogTitle = computed(() => {
  if (activeDialog.value === 'login') return '登录系统';
  if (activeDialog.value === 'profile') return '修改个人信息';
  if (activeDialog.value === 'password') return '修改密码';
  return '上传通联记录';
});
let carouselTimer: number | undefined;

onMounted(async () => {
  carouselTimer = window.setInterval(() => {
    activeSlide.value = (activeSlide.value + 1) % displayCarouselSlides.value.length;
  }, 4200);

  try {
    const me = await api.me();
    user.value = me.user;
  } catch {
    clearToken();
  } finally {
    await loadAll();
    activeDialog.value = null;
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  if (carouselTimer) window.clearInterval(carouselTimer);
  avatarCropper?.destroy();
});

async function signIn() {
  loginError.value = '';
  try {
    user.value = await login(loginForm.callsign, loginForm.password);
    await loadAll();
    activeDialog.value = null;
    ElMessage.success('登录成功');
  } catch (err) {
    loginError.value = err instanceof Error ? err.message : '登录失败';
  }
}

async function loadAll() {
  error.value = '';
  try {
    const [summary, devicePayload, antennaPayload, carouselPayload] = await Promise.all([api.dashboard(), api.devices(), api.antennas(), api.carouselSlides()]);
    dashboard.value = summary;
    devices.value = devicePayload.devices;
    antennas.value = antennaPayload.antennas;
    carouselItems.value = carouselPayload.slides;
    if (activeSlide.value >= displayCarouselSlides.value.length) activeSlide.value = 0;
    if (isAdmin.value) {
      await loadUsers();
    } else {
      users.value = [];
    }
    await loadContacts();
  } catch (err) {
    error.value = err instanceof Error ? err.message : '数据加载失败';
  }
}

async function loadUsers() {
  if (!isAdmin.value) return;
  const payload = await api.users();
  users.value = payload.users;
}

async function loadContacts() {
  const payload = await api.contacts({
    page: contactsState.page,
    pageSize: contactsState.pageSize,
    callsign: contactsState.callsign,
    contactDate: contactsState.contactDate,
    deviceId: contactsState.deviceId,
    antennaId: contactsState.antennaId
  });
  contacts.value = payload.rows;
  contactsState.total = payload.total;
  contactsState.pages = payload.pages;
  selectedContacts.value = [];
}

function applyFilters() {
  contactsState.page = 1;
  void loadContacts();
}

function resetFilters() {
  contactsState.callsign = '';
  contactsState.contactDate = '';
  contactsState.deviceId = '';
  contactsState.antennaId = '';
  applyFilters();
}

function handlePageSizeChange(size: number) {
  contactsState.pageSize = size;
  if (activeNav.value === 'dashboard' || activeNav.value === 'contacts') {
    pageSizeByView[activeNav.value] = size;
  }
  contactsState.page = 1;
  void loadContacts();
}

function handleNav(key: string) {
  if (!user.value && (key === 'devices' || key === 'settings')) {
    openDialog('login');
    return;
  }
  activeNav.value = key;
  if (key === 'dashboard' || key === 'contacts') {
    contactsState.page = 1;
    contactsState.pageSize = pageSizeByView[key];
    void loadContacts();
  }
  if (key === 'settings' && isAdmin.value) {
    void loadUsers();
  }
}

function handleUserCommand(command: 'profile' | 'password' | 'upload' | 'settings' | 'logout') {
  if (command === 'logout') {
    signOut();
    return;
  }
  if (command === 'settings') {
    activeNav.value = 'settings';
    void loadUsers();
    return;
  }
  openDialog(command);
}

function signOut() {
  clearToken();
  user.value = null;
  dashboard.value = null;
  users.value = [];
  batchDeleteMode.value = false;
  selectedContacts.value = [];
  if (!publicNavKeys.has(activeNav.value)) activeNav.value = 'dashboard';
  void loadAll();
  ElMessage.success('已退出登录');
}

async function createManagedUser() {
  try {
    await api.createUser(createUserForm);
    ElMessage.success('用户已新增');
    createUserForm.callsign = '';
    createUserForm.displayName = '';
    createUserForm.password = '';
    createUserForm.role = 'operator';
    await loadUsers();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '新增用户失败');
  }
}

async function changeUserRole(row: ManagedUser, role: 'admin' | 'operator') {
  try {
    await api.updateUserRole(row.id, role);
    ElMessage.success('用户权限已更新');
    await loadUsers();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '修改用户权限失败');
    await loadUsers();
  }
}

async function removeManagedUser(row: ManagedUser) {
  try {
    await ElMessageBox.confirm(`确认删除用户 ${row.callsign} 吗？该用户的设备、天线和通联日志也会一并删除。`, '删除用户确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    });
    const result = await api.deleteUser(row.id);
    ElMessage.success(`已删除 ${result.deleted} 个用户`);
    await loadUsers();
    await loadAll();
  } catch (err) {
    if ((err as { action?: string })?.action !== 'cancel' && err !== 'cancel') {
      ElMessage.error(err instanceof Error ? err.message : '删除用户失败');
    }
  }
}

async function readCarouselImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    ElMessage.error('请选择图片文件');
    input.value = '';
    return;
  }
  if (file.size > 6 * 1024 * 1024) {
    ElMessage.error('轮播图不能超过 6MB');
    input.value = '';
    return;
  }
  try {
    carouselUploadForm.imageUrl = (await api.uploadImage('carousel', await fileToDataUrl(file))).url;
    if (!carouselUploadForm.sortOrder) carouselUploadForm.sortOrder = carouselItems.value.length + 1;
    ElMessage.success('轮播图已上传');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '轮播图上传失败');
  } finally {
    input.value = '';
  }
}

async function createCarouselItem() {
  try {
    if (!carouselUploadForm.imageUrl) {
      ElMessage.warning('请先上传轮播图片');
      return;
    }
    await api.createCarouselSlide({
      title: carouselUploadForm.title.trim(),
      subtitle: carouselUploadForm.subtitle.trim(),
      imageUrl: carouselUploadForm.imageUrl,
      sortOrder: Number(carouselUploadForm.sortOrder || carouselItems.value.length + 1)
    });
    carouselUploadForm.title = '';
    carouselUploadForm.subtitle = '';
    carouselUploadForm.imageUrl = '';
    carouselUploadForm.sortOrder = carouselItems.value.length + 1;
    await loadAll();
    ElMessage.success('轮播图已新增');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '新增轮播图失败');
  }
}

async function saveCarouselItem(row: CarouselSlide) {
  try {
    await api.updateCarouselSlide(row.id, {
      title: row.title,
      subtitle: row.subtitle,
      imageUrl: row.imageUrl,
      sortOrder: Number(row.sortOrder || 0)
    });
    await loadAll();
    ElMessage.success('轮播图已保存');
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存轮播图失败');
  }
}

async function removeCarouselItem(row: CarouselSlide) {
  try {
    await ElMessageBox.confirm('确认删除这张轮播图吗？', '删除轮播图', { type: 'warning' });
    await api.deleteCarouselSlide(row.id);
    await loadAll();
    ElMessage.success('轮播图已删除');
  } catch (err) {
    if ((err as { action?: string })?.action !== 'cancel' && err !== 'cancel') {
      ElMessage.error(err instanceof Error ? err.message : '删除轮播图失败');
    }
  }
}

function openDialog(dialog: 'login' | 'profile' | 'password' | 'upload') {
  userMenuOpen.value = false;
  dialogMessage.value = '';
  dialogError.value = '';
  activeDialog.value = dialog;
  if (dialog === 'login') {
    loginError.value = '';
    loginForm.callsign = '';
    loginForm.password = '';
  }
  if (dialog === 'profile') {
    profileForm.displayName = user.value?.displayName ?? '';
    profileForm.nickname = user.value?.nickname || user.value?.displayName || '';
    profileForm.avatarUrl = user.value?.avatarUrl ?? '';
    profileForm.email = user.value?.email ?? '';
    profileForm.bio = user.value?.bio ?? '';
    profileForm.signature = user.value?.signature ?? '';
    avatarCrop.source = profileForm.avatarUrl.startsWith('data:image/') ? profileForm.avatarUrl : '';
    avatarCrop.zoom = 1;
    avatarCrop.offsetX = 0;
    avatarCrop.offsetY = 0;
  }
  if (dialog === 'password') {
    passwordForm.currentPassword = '';
    passwordForm.newPassword = '';
    passwordForm.confirmPassword = '';
  }
  if (dialog === 'upload') {
    uploadForm.fileName = '';
    uploadForm.content = '';
    uploadPreviewRows.value = [];
  }
}

function handleSelectionChange(rows: Contact[]) {
  selectedContacts.value = rows;
}

function fillEditContactForm(row: Contact) {
  editingContactId.value = row.id;
  editContactForm.contactedAt = formatDateTime(row.contactedAt);
  editContactForm.callsign = row.callsign;
  editContactForm.frequencyMhz = row.frequencyMhz;
  editContactForm.band = row.band;
  editContactForm.mode = row.mode;
  editContactForm.deviceId = row.deviceId || devices.value.find((device) => device.name === row.device)?.id || '';
  editContactForm.antennaId = row.antennaId || antennas.value.find((antenna) => antenna.name === row.antenna)?.id || '';
  editContactForm.location = row.location;
  editContactForm.country = row.country || 'China';
  editContactForm.powerW = row.powerW;
  editContactForm.powerText = row.powerText || `${row.powerW}W`;
  editContactForm.signalReport = row.signalReport;
  editContactForm.note = row.note;
  editContactForm.operatorCallsign = row.operatorCallsign;
}

function openEditCell(row: Contact, column: { property?: string }) {
  if (!canManageContacts.value || batchDeleteMode.value) {
    return;
  }
  const field = column.property as EditableContactField | undefined;
  if (!field || !(field in editableContactFields)) return;
  fillEditContactForm(row);
  editingField.value = field;
  editingCell.id = row.id;
  editingCell.field = field;
}

function startBatchDelete() {
  if (!canManageContacts.value) {
    openDialog('login');
    return;
  }
  batchDeleteMode.value = true;
  selectedContacts.value = [];
}

function cancelBatchDelete() {
  batchDeleteMode.value = false;
  selectedContacts.value = [];
}

function isEditingCell(row: Contact, field: EditableContactField) {
  return editingCell.id === row.id && editingCell.field === field;
}

function cancelInlineEdit() {
  editingCell.id = null;
  editingCell.field = null;
  editingContactId.value = null;
  editingField.value = null;
}

async function saveInlineEdit() {
  if (!editingContactId.value || !editingField.value) return;
  dialogError.value = '';
  try {
    await api.updateContact(editingContactId.value, editContactForm);
    cancelInlineEdit();
    ElMessage.success('通联日志已更新');
    await loadAll();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败');
  }
}

async function deleteSelectedContacts() {
  if (!canManageContacts.value) {
    openDialog('login');
    return;
  }
  if (selectedContacts.value.length === 0) {
    ElMessage.warning('请先选择要删除的通联日志');
    return;
  }
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${selectedContacts.value.length} 条通联日志吗？`, '批量删除确认', {
      type: 'warning',
      confirmButtonText: '批量删除',
      cancelButtonText: '取消'
    });
    const result = await api.deleteContacts(selectedContacts.value.map((row) => row.id));
    ElMessage.success(`已删除 ${result.deleted} 条记录`);
    if (contacts.value.length <= result.deleted && contactsState.page > 1) contactsState.page -= 1;
    batchDeleteMode.value = false;
    await loadAll();
  } catch (err) {
    if ((err as { action?: string })?.action !== 'cancel' && err !== 'cancel') {
      ElMessage.error(err instanceof Error ? err.message : '批量删除失败');
    }
  }
}

async function saveProfile() {
  dialogError.value = '';
  try {
    const nickname = profileForm.nickname.trim();
    const avatarUrl = profileForm.avatarUrl.startsWith('data:image/')
      ? (await api.uploadImage('avatar', profileForm.avatarUrl)).url
      : profileForm.avatarUrl.trim();
    const payload = await api.updateProfile({
      displayName: nickname || user.value?.callsign || profileForm.displayName,
      nickname,
      avatarUrl,
      email: profileForm.email.trim(),
      bio: profileForm.bio.trim(),
      signature: profileForm.signature.trim()
    });
    user.value = payload.user;
    dialogMessage.value = '个人信息已更新';
    ElMessage.success(dialogMessage.value);
  } catch (err) {
    dialogError.value = err instanceof Error ? err.message : '保存失败';
  }
}

async function savePassword() {
  dialogError.value = '';
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    dialogError.value = '两次输入的新密码不一致';
    return;
  }
  try {
    await api.changePassword(passwordForm.currentPassword, passwordForm.newPassword);
    dialogMessage.value = '密码已修改';
    ElMessage.success(dialogMessage.value);
    passwordForm.currentPassword = '';
    passwordForm.newPassword = '';
    passwordForm.confirmPassword = '';
  } catch (err) {
    dialogError.value = err instanceof Error ? err.message : '修改失败';
  }
}

async function readUploadFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  dialogError.value = '';
  dialogMessage.value = '';
  uploadForm.fileName = file.name;
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith('.xlsx')) {
    dialogError.value = '请上传 .xlsx 格式的通联日志模板';
    uploadForm.content = '';
    uploadPreviewRows.value = [];
    return;
  }
  try {
    uploadForm.content = await fileToBase64(file);
    const preview = await api.previewContacts(uploadForm.content);
    uploadPreviewRows.value = preview.rows;
    dialogMessage.value = `已解析 ${preview.total} 条记录，请确认无误后导入`;
    ElMessage.success(dialogMessage.value);
  } catch (err) {
    dialogError.value = err instanceof Error ? err.message : '解析预览失败';
    uploadPreviewRows.value = [];
  }
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

async function readAvatarFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  dialogError.value = '';
  if (!file.type.startsWith('image/')) {
    dialogError.value = '请选择图片文件';
    input.value = '';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    dialogError.value = '头像图片不能超过 2MB';
    input.value = '';
    return;
  }
  avatarCrop.source = await fileToDataUrl(file);
  avatarCrop.zoom = 1;
  avatarCrop.offsetX = 0;
  avatarCrop.offsetY = 0;
  await nextTick();
  initAvatarCropper();
  input.value = '';
}

function initAvatarCropper() {
  avatarCropper?.destroy();
  avatarCropper = null;
  if (!avatarCropImage.value) return;
  avatarCropper = new Cropper(avatarCropImage.value, {
    aspectRatio: 1,
    viewMode: 1,
    autoCropArea: 0.9,
    dragMode: 'move',
    background: false,
    responsive: true,
    crop: () => {
      void applyAvatarCrop();
    }
  });
}

async function applyAvatarCrop() {
  if (!avatarCropper) return;
  try {
    profileForm.avatarUrl = await buildCroppedAvatar();
  } catch (err) {
    dialogError.value = err instanceof Error ? err.message : '头像裁剪失败';
  }
}

async function buildCroppedAvatar() {
  const canvas = avatarCropper?.getCroppedCanvas({ width: 256, height: 256, imageSmoothingQuality: 'high' });
  if (!canvas) throw new Error('头像裁剪失败');
  return canvas.toDataURL('image/png');
}

function clearAvatar() {
  profileForm.avatarUrl = '';
  avatarCrop.source = '';
  avatarCrop.zoom = 1;
  avatarCrop.offsetX = 0;
  avatarCrop.offsetY = 0;
  avatarCropper?.destroy();
  avatarCropper = null;
}

function closeDialog() {
  activeDialog.value = null;
  avatarCropper?.destroy();
  avatarCropper = null;
}

async function submitUpload() {
  dialogError.value = '';
  if (uploadPreviewRows.value.length === 0) {
    dialogError.value = '请先选择模板文件并完成预览';
    return;
  }
  try {
    const result = await api.importContacts('records', JSON.stringify(uploadPreviewRows.value));
    dialogMessage.value = `已导入 ${result.imported} 条记录，跳过 ${result.skipped} 条`;
    ElMessage.success(dialogMessage.value);
    activeDialog.value = null;
    uploadPreviewRows.value = [];
    uploadForm.fileName = '';
    uploadForm.content = '';
    contactsState.page = 1;
    loadAll().catch((loadErr) => {
      ElMessage.warning(loadErr instanceof Error ? loadErr.message : '数据刷新失败，请手动刷新页面');
    });
  } catch (err) {
    dialogError.value = err instanceof Error ? err.message : '上传失败';
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value)).replace(/\//g, '-');
}

function contactRowIndex(index: number) {
  return (contactsState.page - 1) * contactsState.pageSize + index + 1;
}
</script>

<template>
  <main v-if="loading" class="boot-screen">
    <Radio :size="36" />
    <span>正在启动通联日志系统...</span>
  </main>

  <main v-else class="app-shell">
    <header class="topbar">
      <div class="brand-lockup compact">
        <Radio :size="34" />
        <h1>滕州业余无线电通联日志</h1>
      </div>
      <nav class="main-nav">
        <button
          v-for="item in visibleNavItems"
          :key="item.key"
          :class="{ active: activeNav === item.key }"
          @click="handleNav(item.key)"
        >
          <component :is="item.icon" :size="18" />
          {{ item.label }}
        </button>
      </nav>
      <el-dropdown v-if="user" trigger="click" popper-class="hamlog-user-dropdown" @command="handleUserCommand">
        <el-button class="user-menu-button">
          <UserRound :size="16" />
          <span>{{ user?.callsign }} · {{ roleLabel }}</span>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile"><UserCog :size="16" />修改个人信息</el-dropdown-item>
            <el-dropdown-item command="password"><KeyRound :size="16" />修改密码</el-dropdown-item>
            <el-dropdown-item command="upload"><Upload :size="16" />上传通联记录</el-dropdown-item>
            <el-dropdown-item v-if="isAdmin" command="settings"><Settings :size="16" />设置</el-dropdown-item>
            <el-dropdown-item divided command="logout"><LogOut :size="16" />退出</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button v-else class="login-button" @click="openDialog('login')"><UserRound :size="16" />登录</el-button>
    </header>

    <section class="repeater-carousel" aria-label="滕州业余无线电中继台轮播图">
      <div
        v-for="(slide, index) in displayCarouselSlides"
        :key="`${slide.eyebrow}-${index}`"
        class="carousel-slide"
        :class="{ active: activeSlide === index }"
        :style="{ '--hero-image': `url(${slide.image})` }"
      >
      </div>
      <div class="carousel-dots">
        <button
          v-for="(_, index) in displayCarouselSlides"
          :key="index"
          :class="{ active: activeSlide === index }"
          :aria-label="`切换到第 ${index + 1} 张`"
          @click="activeSlide = index"
        ></button>
      </div>
    </section>

    <section v-if="activeNav === 'dashboard'" class="page-content">
      <div class="hero-band">
        <div>
          <h2>通联数据总览</h2>
          <p>实时掌握通联动态，洞察无线电世界</p>
        </div>
        <div class="signal-art">
          <Wifi :size="72" />
        </div>
      </div>

      <p v-if="error" class="data-error">{{ error }}</p>

      <section v-if="dashboard" class="stat-grid">
        <StatCard title="总通联次数" :value="dashboard.cards.totalContacts" subtitle="全部可见记录" color="blue" :icon="Radio" />
        <StatCard title="本月新增" :value="dashboard.cards.monthContacts" subtitle="按当前月份统计" color="teal" :icon="CalendarDays" />
        <StatCard title="活跃主控" :value="dashboard.cards.activeOperators" subtitle="拥有日志的用户" color="purple" :icon="UserRound" />
        <StatCard title="设备数量" :value="dashboard.cards.deviceCount" subtitle="可用电台设备" color="orange" :icon="Laptop" />
      </section>

      <section class="panel log-panel">
        <div class="panel-title">
          <h3 class="title-with-icon"><ListChecks :size="18" />通联日志详情</h3>
        </div>
        <el-form class="filters log-filters" inline @submit.prevent>
          <el-input v-model="contactsState.callsign" clearable placeholder="呼号" @keyup.enter="applyFilters" />
          <el-date-picker v-model="contactsState.contactDate" type="date" value-format="YYYY-MM-DD" placeholder="通联时间" popper-class="hamlog-date-popper" :popper-options="{ strategy: 'fixed' }" />
          <el-select v-model="contactsState.deviceId" clearable filterable placeholder="设备">
            <el-option v-for="device in devices" :key="device.id" :label="device.name" :value="String(device.id)" />
          </el-select>
          <el-select v-model="contactsState.antennaId" clearable filterable placeholder="天线">
            <el-option v-for="antenna in antennas" :key="antenna.id" :label="antenna.name" :value="String(antenna.id)" />
          </el-select>
          <div class="filter-actions">
            <el-button type="primary" @click="applyFilters"><SlidersHorizontal :size="16" />筛选</el-button>
            <el-button @click="resetFilters">重置</el-button>
            <el-button class="view-full-log" @click="handleNav('contacts')">查看完整日志</el-button>
          </div>
        </el-form>
        <el-table :data="contacts" border stripe class="hamlog-table desktop-log-table">
          <el-table-column label="序号" width="72" align="center">
            <template #default="{ $index }">{{ contactRowIndex($index) }}</template>
          </el-table-column>
          <el-table-column label="通联时间" min-width="150">
            <template #default="{ row }">{{ formatDateTime(row.contactedAt) }}</template>
          </el-table-column>
          <el-table-column prop="callsign" label="呼号" min-width="110" />
          <el-table-column label="频率" min-width="120">
            <template #default="{ row }">{{ row.frequencyMhz.toFixed(3) }} MHz</template>
          </el-table-column>
          <el-table-column prop="mode" label="模式" width="80" />
          <el-table-column prop="device" label="使用设备" min-width="140" />
          <el-table-column prop="antenna" label="天线" min-width="130" />
          <el-table-column prop="location" label="位置" min-width="180" />
          <el-table-column label="功率" width="90">
            <template #default="{ row }">{{ row.powerText || `${row.powerW}W` }}</template>
          </el-table-column>
          <el-table-column prop="signalReport" label="信号报告" width="100" />
          <el-table-column prop="note" label="备注" min-width="130" />
        </el-table>
        <div class="mobile-log-list" aria-label="移动端通联日志">
          <article v-for="(row, index) in contacts" :key="row.id" class="mobile-log-card">
            <div class="mobile-log-card__head">
              <span class="mobile-log-index">#{{ contactRowIndex(index) }}</span>
              <strong>{{ row.callsign }}</strong>
            </div>
            <div class="mobile-log-time">{{ formatDateTime(row.contactedAt) }}</div>
            <dl class="mobile-log-details">
              <div>
                <dt>频率</dt>
                <dd>{{ row.frequencyMhz.toFixed(3) }} MHz</dd>
              </div>
              <div>
                <dt>模式</dt>
                <dd>{{ row.mode || '-' }}</dd>
              </div>
              <div>
                <dt>设备</dt>
                <dd>{{ row.device || '-' }}</dd>
              </div>
              <div>
                <dt>天线</dt>
                <dd>{{ row.antenna || '-' }}</dd>
              </div>
              <div>
                <dt>位置</dt>
                <dd>{{ row.location || '-' }}</dd>
              </div>
              <div>
                <dt>信号</dt>
                <dd>{{ row.signalReport || '-' }}</dd>
              </div>
            </dl>
          </article>
        </div>
        <div class="pagination">
          <span>共 {{ contactsState.total.toLocaleString('zh-CN') }} 条记录</span>
          <el-pagination
            v-model:current-page="contactsState.page"
            v-model:page-size="contactsState.pageSize"
            :page-sizes="[15, 30, 50, 100, 150]"
            :total="contactsState.total"
            :pager-count="5"
            :layout="activeNav === 'dashboard' ? 'prev, pager, next' : 'sizes, prev, pager, next'"
            @current-change="loadContacts"
            @size-change="handlePageSizeChange"
          />
        </div>
      </section>

      <section v-if="dashboard" class="rank-grid">
        <RankPanel title="通联次数排行榜" :items="dashboard.ranks.callsigns" />
        <RankPanel title="主控贡献排行榜" :items="dashboard.ranks.operators" />
        <RankPanel title="设备排行榜" :items="dashboard.ranks.devices" />
      </section>

      <section v-if="dashboard" class="analytics-grid">
        <article class="panel trend-panel"><h3 class="title-with-icon"><TrendingUp :size="18" />近一年通联情况总结</h3><LineChart :data="dashboard.trends.monthly" /></article>
        <article class="panel report-panel">
          <h3 class="title-with-icon"><FileText :size="18" />总结报告</h3>
          <p>{{ dashboard.report.text }}</p>
          <div class="metric-row">
            <div v-for="metric in dashboard.report.metrics" :key="metric.label">
              <b>{{ metric.value }}</b>
              <span>{{ metric.label }}{{ metric.unit }}</span>
            </div>
          </div>
        </article>
      </section>
    </section>

    <section v-else-if="activeNav === 'contacts'" class="page-content compact-page">
      <div class="section-heading">
        <h2 class="title-with-icon page-title-icon"><Database :size="26" />通联日志</h2>
        <p>筛选、分页查看当前账号可访问的全部通联记录。</p>
      </div>
      <section class="panel log-panel standalone">
        <el-form class="filters log-filters" inline @submit.prevent>
          <el-input v-model="contactsState.callsign" clearable placeholder="呼号" @keyup.enter="applyFilters" />
          <el-date-picker v-model="contactsState.contactDate" type="date" value-format="YYYY-MM-DD" placeholder="通联时间" popper-class="hamlog-date-popper" :popper-options="{ strategy: 'fixed' }" />
          <el-select v-model="contactsState.deviceId" clearable filterable placeholder="设备">
            <el-option v-for="device in devices" :key="device.id" :label="device.name" :value="String(device.id)" />
          </el-select>
          <el-select v-model="contactsState.antennaId" clearable filterable placeholder="天线">
            <el-option v-for="antenna in antennas" :key="antenna.id" :label="antenna.name" :value="String(antenna.id)" />
          </el-select>
          <div class="filter-actions">
            <el-button type="primary" @click="applyFilters">筛选</el-button>
            <el-button @click="resetFilters">重置</el-button>
            <el-button v-if="canManageContacts && !batchDeleteMode" type="danger" plain @click="startBatchDelete">批量删除</el-button>
            <el-button v-if="canManageContacts && batchDeleteMode" type="danger" :disabled="selectedContacts.length === 0" @click="deleteSelectedContacts">
              删除 {{ selectedContacts.length }}
            </el-button>
            <el-button v-if="canManageContacts && batchDeleteMode" @click="cancelBatchDelete">取消</el-button>
          </div>
        </el-form>
        <el-table
          :data="contacts"
          border
          stripe
          :class="['hamlog-table desktop-log-table', canManageContacts && !batchDeleteMode ? 'editable-table' : '']"
          row-key="id"
          @selection-change="handleSelectionChange"
          @cell-click="openEditCell"
        >
          <el-table-column v-if="canManageContacts && batchDeleteMode" type="selection" width="46" />
          <el-table-column label="序号" width="72" align="center">
            <template #default="{ $index }">{{ contactRowIndex($index) }}</template>
          </el-table-column>
          <el-table-column prop="contactedAt" label="通联时间" min-width="170">
            <template #default="{ row }">
              <el-input
                v-if="isEditingCell(row, 'contactedAt')"
                v-model="editContactForm.contactedAt"
                size="small"
                autofocus
                @blur="saveInlineEdit"
                @keyup.enter="saveInlineEdit"
                @keyup.esc="cancelInlineEdit"
              />
              <el-tooltip v-else-if="canManageContacts" content="点击修改通联时间" placement="top"><span class="editable-cell-text">{{ formatDateTime(row.contactedAt) }}</span></el-tooltip>
              <span v-else>{{ formatDateTime(row.contactedAt) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="callsign" label="呼号" min-width="120">
            <template #default="{ row }">
              <el-input
                v-if="isEditingCell(row, 'callsign')"
                v-model="editContactForm.callsign"
                size="small"
                autofocus
                @blur="saveInlineEdit"
                @keyup.enter="saveInlineEdit"
                @keyup.esc="cancelInlineEdit"
              />
              <el-tooltip v-else-if="canManageContacts" content="点击修改呼号" placement="top"><span class="editable-cell-text">{{ row.callsign }}</span></el-tooltip>
              <span v-else>{{ row.callsign }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="frequencyMhz" label="频率" min-width="120">
            <template #default="{ row }">
              <el-input-number
                v-if="isEditingCell(row, 'frequencyMhz')"
                v-model="editContactForm.frequencyMhz"
                size="small"
                :step="0.001"
                :controls="false"
                @blur="saveInlineEdit"
                @keyup.enter="saveInlineEdit"
                @keyup.esc="cancelInlineEdit"
              />
              <el-tooltip v-else-if="canManageContacts" content="点击修改频率" placement="top"><span class="editable-cell-text">{{ row.frequencyMhz.toFixed(3) }} MHz</span></el-tooltip>
              <span v-else>{{ row.frequencyMhz.toFixed(3) }} MHz</span>
            </template>
          </el-table-column>
          <el-table-column prop="mode" label="模式" width="100">
            <template #default="{ row }">
              <el-input
                v-if="isEditingCell(row, 'mode')"
                v-model="editContactForm.mode"
                size="small"
                autofocus
                @blur="saveInlineEdit"
                @keyup.enter="saveInlineEdit"
                @keyup.esc="cancelInlineEdit"
              />
              <el-tooltip v-else-if="canManageContacts" content="点击修改模式" placement="top"><span class="editable-cell-text">{{ row.mode }}</span></el-tooltip>
              <span v-else>{{ row.mode }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="deviceId" label="设备" min-width="140">
            <template #default="{ row }">
              <el-select
                v-if="isEditingCell(row, 'deviceId')"
                v-model="editContactForm.deviceId"
                size="small"
                filterable
                @change="saveInlineEdit"
                @keyup.esc="cancelInlineEdit"
              >
                <el-option v-for="device in devices" :key="device.id" :label="device.name" :value="device.id" />
              </el-select>
              <el-tooltip v-else-if="canManageContacts" content="点击修改设备" placement="top"><span class="editable-cell-text">{{ row.device }}</span></el-tooltip>
              <span v-else>{{ row.device }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="antennaId" label="天线" min-width="130">
            <template #default="{ row }">
              <el-select
                v-if="isEditingCell(row, 'antennaId')"
                v-model="editContactForm.antennaId"
                size="small"
                filterable
                @change="saveInlineEdit"
                @keyup.esc="cancelInlineEdit"
              >
                <el-option v-for="antenna in antennas" :key="antenna.id" :label="antenna.name" :value="antenna.id" />
              </el-select>
              <el-tooltip v-else-if="canManageContacts" content="点击修改天线" placement="top"><span class="editable-cell-text">{{ row.antenna }}</span></el-tooltip>
              <span v-else>{{ row.antenna }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="location" label="位置" min-width="180">
            <template #default="{ row }">
              <el-input
                v-if="isEditingCell(row, 'location')"
                v-model="editContactForm.location"
                size="small"
                autofocus
                @blur="saveInlineEdit"
                @keyup.enter="saveInlineEdit"
                @keyup.esc="cancelInlineEdit"
              />
              <el-tooltip v-else-if="canManageContacts" content="点击修改位置" placement="top"><span class="editable-cell-text">{{ row.location }}</span></el-tooltip>
              <span v-else>{{ row.location }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="powerText" label="功率" width="90">
            <template #default="{ row }">
              <el-input
                v-if="isEditingCell(row, 'powerText')"
                v-model="editContactForm.powerText"
                size="small"
                autofocus
                @blur="saveInlineEdit"
                @keyup.enter="saveInlineEdit"
                @keyup.esc="cancelInlineEdit"
              />
              <el-tooltip v-else-if="canManageContacts" content="点击修改功率" placement="top"><span class="editable-cell-text">{{ row.powerText || `${row.powerW}W` }}</span></el-tooltip>
              <span v-else>{{ row.powerText || `${row.powerW}W` }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="signalReport" label="信号" width="100">
            <template #default="{ row }">
              <el-input
                v-if="isEditingCell(row, 'signalReport')"
                v-model="editContactForm.signalReport"
                size="small"
                autofocus
                @blur="saveInlineEdit"
                @keyup.enter="saveInlineEdit"
                @keyup.esc="cancelInlineEdit"
              />
              <el-tooltip v-else-if="canManageContacts" content="点击修改信号" placement="top"><span class="editable-cell-text">{{ row.signalReport }}</span></el-tooltip>
              <span v-else>{{ row.signalReport }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="note" label="备注" min-width="150">
            <template #default="{ row }">
              <el-input
                v-if="isEditingCell(row, 'note')"
                v-model="editContactForm.note"
                size="small"
                autofocus
                @blur="saveInlineEdit"
                @keyup.enter="saveInlineEdit"
                @keyup.esc="cancelInlineEdit"
              />
              <el-tooltip v-else-if="canManageContacts" content="点击修改备注" placement="top"><span class="editable-cell-text">{{ row.note || '-' }}</span></el-tooltip>
              <span v-else>{{ row.note }}</span>
            </template>
          </el-table-column>
        </el-table>
        <div class="mobile-log-list" aria-label="移动端通联日志">
          <article v-for="(row, index) in contacts" :key="row.id" class="mobile-log-card">
            <div class="mobile-log-card__head">
              <span class="mobile-log-index">#{{ contactRowIndex(index) }}</span>
              <strong>{{ row.callsign }}</strong>
            </div>
            <div class="mobile-log-time">{{ formatDateTime(row.contactedAt) }}</div>
            <dl class="mobile-log-details">
              <div>
                <dt>频率</dt>
                <dd>{{ row.frequencyMhz.toFixed(3) }} MHz</dd>
              </div>
              <div>
                <dt>模式</dt>
                <dd>{{ row.mode || '-' }}</dd>
              </div>
              <div>
                <dt>设备</dt>
                <dd>{{ row.device || '-' }}</dd>
              </div>
              <div>
                <dt>天线</dt>
                <dd>{{ row.antenna || '-' }}</dd>
              </div>
              <div>
                <dt>位置</dt>
                <dd>{{ row.location || '-' }}</dd>
              </div>
              <div>
                <dt>信号</dt>
                <dd>{{ row.signalReport || '-' }}</dd>
              </div>
            </dl>
          </article>
        </div>
        <div class="pagination">
          <span>共 {{ contactsState.total.toLocaleString('zh-CN') }} 条</span>
          <el-pagination
            v-model:current-page="contactsState.page"
            v-model:page-size="contactsState.pageSize"
            :page-sizes="[15, 30, 50, 100, 150]"
            :total="contactsState.total"
            :pager-count="5"
            :layout="activeNav === 'contacts' ? 'prev, pager, next' : 'sizes, prev, pager, next'"
            @current-change="loadContacts"
            @size-change="handlePageSizeChange"
          />
        </div>
      </section>
    </section>

    <section v-else-if="activeNav === 'settings'" class="page-content compact-page">
      <div class="section-heading">
        <h2 class="title-with-icon page-title-icon"><Settings :size="26" />设置</h2>
        <p>管理员可维护系统用户，并设置用户角色。</p>
      </div>
      <section v-if="isAdmin" class="panel user-admin-panel standalone">
        <div class="panel-title">
          <h3 class="title-with-icon"><UserCog :size="18" />权限管理</h3>
        </div>
        <el-form class="user-create-form" inline @submit.prevent>
          <el-input v-model="createUserForm.callsign" clearable placeholder="呼号" />
          <el-input v-model="createUserForm.displayName" clearable placeholder="显示名称" />
          <el-input v-model="createUserForm.password" clearable show-password type="password" placeholder="初始密码" />
          <el-select v-model="createUserForm.role" placeholder="角色">
            <el-option label="操作员" value="operator" />
            <el-option label="管理员" value="admin" />
          </el-select>
          <el-button type="primary" @click="createManagedUser">新增用户</el-button>
        </el-form>
        <el-table :data="users" border stripe class="hamlog-table user-table">
          <el-table-column prop="callsign" label="呼号" min-width="120" />
          <el-table-column prop="displayName" label="显示名称" min-width="160" />
          <el-table-column label="角色" min-width="140">
            <template #default="{ row }">
              <el-select
                :model-value="row.role"
                :disabled="row.id === user?.id"
                size="small"
                @change="(role: 'admin' | 'operator') => changeUserRole(row, role)"
              >
                <el-option label="操作员" value="operator" />
                <el-option label="管理员" value="admin" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" min-width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="120" align="center">
            <template #default="{ row }">
              <el-button link type="danger" :disabled="row.id === user?.id" @click="removeManagedUser(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>
      <section v-if="isAdmin" class="panel carousel-admin-panel standalone">
        <div class="panel-title">
          <h3 class="title-with-icon"><FileText :size="18" />轮播图管理</h3>
        </div>
        <el-form class="carousel-create-form" inline @submit.prevent>
          <el-input v-model="carouselUploadForm.title" clearable placeholder="标题" />
          <el-input v-model="carouselUploadForm.subtitle" clearable placeholder="说明文字" />
          <el-input-number v-model="carouselUploadForm.sortOrder" :min="0" :controls="false" placeholder="排序" />
          <label class="el-button el-button--primary upload-file-button">
            上传图片
            <input type="file" accept="image/*" @change="readCarouselImage" />
          </label>
          <el-button type="success" :disabled="!carouselUploadForm.imageUrl" @click="createCarouselItem">新增轮播图</el-button>
        </el-form>
        <div v-if="carouselUploadForm.imageUrl" class="carousel-upload-preview">
          <img :src="carouselUploadForm.imageUrl" alt="待新增轮播图" />
        </div>
        <el-table :data="carouselItems" border stripe class="hamlog-table carousel-table">
          <el-table-column label="图片" width="180">
            <template #default="{ row }"><img :src="row.imageUrl" class="carousel-thumb" alt="轮播图" /></template>
          </el-table-column>
          <el-table-column label="标题" min-width="150">
            <template #default="{ row }"><el-input v-model="row.title" /></template>
          </el-table-column>
          <el-table-column label="说明" min-width="220">
            <template #default="{ row }"><el-input v-model="row.subtitle" /></template>
          </el-table-column>
          <el-table-column label="排序" width="110">
            <template #default="{ row }"><el-input-number v-model="row.sortOrder" :controls="false" /></template>
          </el-table-column>
          <el-table-column label="操作" width="150" align="center">
            <template #default="{ row }">
              <el-button link type="primary" @click="saveCarouselItem(row)">保存</el-button>
              <el-button link type="danger" @click="removeCarouselItem(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>
      <div v-else class="placeholder-panel">
        <Settings :size="44" />
        <h2>设置</h2>
        <p>当前账号为操作员，可使用日志上传、筛选和维护本人通联记录。用户权限管理仅管理员可用。</p>
      </div>
    </section>

    <section v-else class="page-content compact-page">
      <div class="placeholder-panel">
        <component :is="navItems.find((item) => item.key === activeNav)?.icon" :size="44" />
        <h2>{{ navItems.find((item) => item.key === activeNav)?.label }}</h2>
        <p>该模块已预留导航入口，后续可继续扩展 CRUD、统计钻取和系统配置。</p>
      </div>
    </section>

    <footer class="statusbar">
      <span>业余无线电通联记录系统 © 2026</span>
      <span>UTC+8 · {{ new Date().toLocaleString('zh-CN', { hour12: false }) }}</span>
      <span class="sync"><BarChart3 :size="18" /> 数据已同步</span>
    </footer>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      :width="activeDialog === 'upload' ? '92vw' : activeDialog === 'profile' ? '720px' : '520px'"
      class="hamlog-dialog"
      destroy-on-close
      @closed="closeDialog"
    >
      <el-form v-if="activeDialog === 'login'" label-position="top" @submit.prevent>
        <el-form-item label="呼号"><el-input v-model="loginForm.callsign" autocomplete="username" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="loginForm.password" type="password" autocomplete="current-password" show-password /></el-form-item>
        <el-alert v-if="loginError" :title="loginError" type="error" :closable="false" />
        <div class="dialog-actions"><el-button type="primary" @click="signIn">登录系统</el-button></div>
      </el-form>

      <el-form v-else-if="activeDialog === 'profile'" label-position="top" @submit.prevent>
        <el-form-item label="呼号"><el-input :model-value="user?.callsign" disabled /></el-form-item>
        <el-form-item label="昵称"><el-input v-model="profileForm.nickname" placeholder="请输入昵称" /></el-form-item>
        <el-form-item label="头像">
          <div class="avatar-editor">
            <div class="avatar-toolbar">
              <label class="el-button el-button--primary upload-file-button">
                选择图片
                <input type="file" accept="image/*" @change="readAvatarFile" />
              </label>
              <el-button :disabled="!profileForm.avatarUrl" @click="clearAvatar">清除头像</el-button>
            </div>
            <div v-if="avatarCrop.source" class="avatar-crop-layout">
              <div class="avatar-cropper">
                <img ref="avatarCropImage" :src="avatarCrop.source" alt="头像裁剪" @load="initAvatarCropper" />
              </div>
              <div class="avatar-crop-controls">
                <p>拖动图片调整位置，滚轮或双指缩放。裁剪框固定为 1:1。</p>
                <el-button type="primary" plain @click="applyAvatarCrop">应用裁剪</el-button>
              </div>
            </div>
            <div v-if="profileForm.avatarUrl" class="avatar-preview-row">
              <div>
                <img :src="profileForm.avatarUrl" class="avatar-preview square" alt="正方形头像示例" />
                <span>正方形</span>
              </div>
              <div>
                <img :src="profileForm.avatarUrl" class="avatar-preview circle" alt="圆形头像示例" />
                <span>圆形</span>
              </div>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="邮箱"><el-input v-model="profileForm.email" placeholder="name@example.com" /></el-form-item>
        <el-form-item label="自我介绍"><el-input v-model="profileForm.bio" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="签名"><el-input v-model="profileForm.signature" type="textarea" :rows="2" /></el-form-item>
        <el-alert v-if="dialogError" :title="dialogError" type="error" :closable="false" />
        <div class="dialog-actions"><el-button type="primary" @click="saveProfile">保存信息</el-button></div>
      </el-form>

      <el-form v-else-if="activeDialog === 'password'" label-position="top" @submit.prevent>
        <el-form-item label="当前密码"><el-input v-model="passwordForm.currentPassword" type="password" show-password /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="passwordForm.newPassword" type="password" show-password /></el-form-item>
        <el-form-item label="确认新密码"><el-input v-model="passwordForm.confirmPassword" type="password" show-password /></el-form-item>
        <el-alert v-if="dialogError" :title="dialogError" type="error" :closable="false" />
        <div class="dialog-actions"><el-button type="primary" @click="savePassword">修改密码</el-button></div>
      </el-form>

      <div v-else class="upload-dialog-body">
        <div class="upload-actions">
          <el-button tag="a" href="/templates/通联日志模板.xlsx" download>下载通联日志模板</el-button>
          <label class="el-button el-button--primary upload-file-button">
            上传通联记录
            <input type="file" accept=".xlsx" @change="readUploadFile" />
          </label>
          <span v-if="uploadForm.fileName" class="upload-file-name">已选择：{{ uploadForm.fileName }}</span>
        </div>
        <el-alert v-if="dialogError" :title="dialogError" type="error" :closable="false" />
        <el-alert v-if="dialogMessage" :title="dialogMessage" type="success" :closable="false" />
        <el-table v-if="uploadPreviewRows.length" :data="uploadPreviewRows" border stripe height="56vh" class="hamlog-table upload-preview-table">
          <el-table-column fixed label="日期时间" min-width="170"><template #default="{ row }"><el-input v-model="row.contactedAt" /></template></el-table-column>
          <el-table-column fixed label="呼号" min-width="120"><template #default="{ row }"><el-input v-model="row.callsign" /></template></el-table-column>
          <el-table-column label="频率" min-width="120"><template #default="{ row }"><el-input-number v-model="row.frequencyMhz" :step="0.001" :controls="false" /></template></el-table-column>
          <el-table-column label="模式" min-width="90"><template #default="{ row }"><el-input v-model="row.mode" /></template></el-table-column>
          <el-table-column label="设备" min-width="150"><template #default="{ row }"><el-input v-model="row.deviceName" /></template></el-table-column>
          <el-table-column label="天线" min-width="140"><template #default="{ row }"><el-input v-model="row.antennaName" /></template></el-table-column>
          <el-table-column label="位置" min-width="210"><template #default="{ row }"><el-input v-model="row.location" /></template></el-table-column>
          <el-table-column label="功率" min-width="110"><template #default="{ row }"><el-input v-model="row.powerText" /></template></el-table-column>
          <el-table-column label="信号" min-width="100"><template #default="{ row }"><el-input v-model="row.signalReport" /></template></el-table-column>
          <el-table-column label="值机主控" min-width="120"><template #default="{ row }"><el-input v-model="row.operatorCallsign" /></template></el-table-column>
          <el-table-column label="备注" min-width="160"><template #default="{ row }"><el-input v-model="row.note" /></template></el-table-column>
        </el-table>
      </div>
      <template v-if="activeDialog === 'upload'" #footer>
        <el-button @click="activeDialog = null">取消</el-button>
        <el-button type="primary" :disabled="uploadPreviewRows.length === 0" @click="submitUpload">确认导入数据库</el-button>
      </template>
    </el-dialog>
  </main>
</template>
