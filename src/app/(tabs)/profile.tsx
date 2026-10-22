import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardTypeOptions, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { auth, db } from '../../../firebaseConfig';

type ProfileFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  isEditing: boolean;
  isLast?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
};

type OfficerProfile = {
  fullName: string;
  phoneNumber: string;
  contactEmail: string;
  username: string;
  employeeId: string;
};

export default function ProfileScreen() {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [username, setUsername] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [savedProfile, setSavedProfile] = useState<OfficerProfile | null>(null);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        router.replace('/login');
        return;
      }

      const profile: OfficerProfile = {
        fullName: user.displayName || '',
        phoneNumber: user.phoneNumber || '',
        contactEmail: user.email || '',
        username: '',
        employeeId: '',
      };

      try {
        const snapshot = await getDoc(doc(db, 'users_info', user.uid));
        if (snapshot.exists()) {
          const data = snapshot.data();
          profile.fullName = data.fullName || profile.fullName;
          profile.phoneNumber = data.phoneNumber || profile.phoneNumber;
          profile.contactEmail = data.contactEmail || data.email || profile.contactEmail;
          profile.username = data.username || '';
          profile.employeeId = data.employeeId || '';
        }
      } catch (error: any) {
        console.error('Error loading officer profile:', error);
        Alert.alert('Could not load profile', error.message || 'Please try again.');
      } finally {
        if (active) {
          setFullName(profile.fullName);
          setPhoneNumber(profile.phoneNumber);
          setContactEmail(profile.contactEmail);
          setUsername(profile.username);
          setEmployeeId(profile.employeeId);
          setSavedProfile(profile);
          setLoading(false);
        }
      }
    }

    loadProfile();
    return () => { active = false; };
  }, [router]);

  const handleSave = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in again to save your profile.');
      router.replace('/login');
      return;
    }
    if (!fullName.trim()) {
      Alert.alert('Name required', 'Enter the safety officer’s name before saving.');
      return;
    }
    if (contactEmail.trim() && !/^\S+@\S+\.\S+$/.test(contactEmail.trim())) {
      Alert.alert('Check email', 'Enter a valid contact email address.');
      return;
    }

    setSaving(true);
    try {
      const updatedProfile = {
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        contactEmail: contactEmail.trim(),
        username: username.trim(),
        employeeId: employeeId.trim(),
      };
      await setDoc(doc(db, 'users_info', user.uid), {
        ...updatedProfile,
        // Preserve the existing field used by older app screens.
        email: updatedProfile.contactEmail,
      }, { merge: true });
      setSavedProfile(updatedProfile);
      setIsEditing(false);
      Alert.alert('Profile saved', 'Your officer details have been updated.');
    } catch (error: any) {
      console.error('Error saving officer profile:', error);
      Alert.alert('Could not save profile', error.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      router.replace('/login');
    } catch (error: any) {
      Alert.alert('Logout failed', error.message || 'Please try again.');
    }
  };

  const handleCancelEdit = () => {
    if (savedProfile) {
      setFullName(savedProfile.fullName);
      setPhoneNumber(savedProfile.phoneNumber);
      setContactEmail(savedProfile.contactEmail);
      setUsername(savedProfile.username);
      setEmployeeId(savedProfile.employeeId);
    }
    setIsEditing(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Officer Profile</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}><Ionicons name="person" size={42} color="#FFFFFF" /></View>
          <Text style={styles.profileSubtitle}>Safety officer details</Text>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#FFFFFF" style={styles.loading} />
        ) : (
          <>
            <View style={styles.infoCard}>
              <ProfileField label="Full Name" value={fullName} onChangeText={setFullName} isEditing={isEditing} autoCapitalize="words" />
              <ProfileField label="Contact Email" value={contactEmail} onChangeText={setContactEmail} isEditing={isEditing} keyboardType="email-address" autoCapitalize="none" />
              <ProfileField label="Phone Number" value={phoneNumber} onChangeText={setPhoneNumber} isEditing={isEditing} keyboardType="phone-pad" />
              <ProfileField label="Username" value={username} onChangeText={setUsername} isEditing={isEditing} autoCapitalize="none" />
              <ProfileField label="Work ID" value={employeeId} onChangeText={setEmployeeId} isEditing={isEditing} isLast />
            </View>

            <Text style={styles.helperText}>Contact email is saved to your officer profile; it does not change your sign-in email.</Text>

            {isEditing ? (
              <View style={styles.editActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={handleCancelEdit} disabled={saving}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
                  <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save Details'}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.editButton} onPress={() => setIsEditing(true)}>
                <Ionicons name="create-outline" size={17} color="#FFFFFF" />
                <Text style={styles.editButtonText}>Edit Profile</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} accessibilityRole="button">
          <Ionicons name="log-out-outline" size={18} color="#FFFFFF" />
          <Text style={styles.logoutButtonText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function ProfileField({ label, value, onChangeText, isEditing, isLast = false, keyboardType = 'default', autoCapitalize = 'sentences' }: ProfileFieldProps) {
  return (
    <View style={[styles.infoRow, isLast && styles.lastRow]}>
      <Text style={styles.infoLabel}>{label}</Text>
      {isEditing ? (
        <TextInput
          style={styles.inputField}
          value={value}
          onChangeText={onChangeText}
          placeholder={`Add ${label.toLowerCase()}`}
          placeholderTextColor="#A9A9A9"
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={keyboardType === 'default'}
        />
      ) : (
        <Text style={[styles.infoValue, !value && styles.emptyValue]} numberOfLines={2}>
          {value || 'Not added'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#5C4B4B' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 54, marginBottom: 14 },
  backButton: { backgroundColor: '#4A3B3B', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
  headerSpacer: { width: 40 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 120 },
  avatarContainer: { alignItems: 'center', marginTop: 8, marginBottom: 22 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#A69691', alignItems: 'center', justifyContent: 'center' },
  profileSubtitle: { color: '#E2D9D6', fontSize: 12, marginTop: 9 },
  loading: { marginTop: 24 },
  infoCard: { backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 4, marginBottom: 9 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  lastRow: { borderBottomWidth: 0 },
  infoLabel: { fontSize: 12, color: '#333333', fontWeight: '600', width: '34%' },
  infoValue: { fontSize: 12, color: '#454B52', textAlign: 'right', flex: 1 },
  emptyValue: { color: '#A9A9A9' },
  inputField: { flex: 1, fontSize: 13, color: '#252A30', textAlign: 'right', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#4E7D34' },
  helperText: { color: '#E2D9D6', fontSize: 10, lineHeight: 15, marginBottom: 14 },
  editActions: { flexDirection: 'row', gap: 10 },
  cancelButton: { flex: 1, backgroundColor: '#756866', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  editButton: { backgroundColor: '#4E7D34', borderRadius: 12, paddingVertical: 14, flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center' },
  editButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  saveButton: { flex: 1, backgroundColor: '#4E7D34', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  logoutButton: { backgroundColor: '#4A1515', borderRadius: 12, paddingVertical: 14, marginTop: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  logoutButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
